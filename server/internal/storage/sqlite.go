// Package storage owns the durable document, conflict index and transaction receipts.
package storage

import (
	"buildingmomo/server/internal/document"
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var ErrNotFound = errors.New("Room not found")
var ErrExists = errors.New("Room already exists")
var ErrConcurrent = errors.New("document revision changed")

type Store struct{ db *sql.DB }
type Record struct {
	ID       string
	Document *document.Document
	Index    document.Index
}
type Metadata struct {
	ObjectID  string `json:"objectId"`
	RoomCode  string `json:"roomCode"`
	Revision  int64  `json:"revision"`
	UpdatedAt int64  `json:"updatedAt"`
	Scheme    struct {
		Name             string   `json:"name"`
		ItemCount        int      `json:"itemCount"`
		GroupOriginCount int      `json:"groupOriginCount"`
		FilePath         *string  `json:"filePath,omitempty"`
		LastModified     *float64 `json:"lastModified,omitempty"`
	} `json:"scheme"`
}

func Open(path string) (*Store, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
		return nil, err
	}
	// Establish private permissions before SQLite creates its WAL/SHM siblings.
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	err = f.Chmod(0600)
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return nil, errors.Join(err, closeErr)
	}
	filePath := filepath.ToSlash(abs)
	if runtime.GOOS == "windows" {
		filePath = "/" + filePath
	}
	u := url.URL{Scheme: "file", Path: filePath}
	q := url.Values{}
	for _, pragma := range []string{"foreign_keys(1)", "journal_mode(WAL)", "synchronous(FULL)", "busy_timeout(5000)", "cache_size(-8192)"} {
		q.Add("_pragma", pragma)
	}
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	fail := func(e error) (*Store, error) { db.Close(); return nil, e }
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fail(err)
	}
	if version > 1 {
		return fail(errors.New("database is newer than this server"))
	}
	if version == 0 {
		_, err = db.Exec(`BEGIN;
 CREATE TABLE rooms(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,document BLOB NOT NULL,conflict BLOB NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE receipts(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,tx_id TEXT NOT NULL,revision INTEGER NOT NULL,payload BLOB,PRIMARY KEY(room_id,tx_id),UNIQUE(room_id,revision));
 PRAGMA user_version=1; COMMIT;`)
		if err != nil {
			return fail(err)
		}
	}
	if err = os.Chmod(abs, 0600); err != nil {
		return fail(err)
	}
	return &Store{db: db}, nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) load(ctx context.Context, where, value string) (Record, error) {
	var r Record
	var d, b []byte
	err := s.db.QueryRowContext(ctx, "SELECT id,document,conflict FROM rooms WHERE "+where+"=?", value).Scan(&r.ID, &d, &b)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	if err = json.Unmarshal(d, &r.Document); err != nil {
		return r, err
	}
	if err = document.Normalize(r.Document); err != nil {
		return r, err
	}
	if err = json.Unmarshal(b, &r.Index); err != nil {
		return r, err
	}
	return r, document.ValidateIndex(r.Index, r.Document.Revision)
}
func (s *Store) Load(ctx context.Context, code string) (Record, error) {
	return s.load(ctx, "code", code)
}
func (s *Store) LoadID(ctx context.Context, id string) (Record, error) { return s.load(ctx, "id", id) }
func encode(r Record) ([]byte, []byte, error) {
	d, err := json.Marshal(r.Document)
	if err != nil {
		return nil, nil, err
	}
	b, err := json.Marshal(r.Index)
	return d, b, err
}
func (s *Store) Create(ctx context.Context, r Record) error {
	d, b, err := encode(r)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO rooms(id,code,document,conflict,revision) VALUES(?,?,?,?,?)", r.ID, r.Document.RoomCode, d, b, r.Document.Revision)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return ErrExists
	}
	return err
}
func (s *Store) Receipt(ctx context.Context, roomID, txID string) (int64, error) {
	var revision int64
	err := s.db.QueryRowContext(ctx, "SELECT revision FROM receipts WHERE room_id=? AND tx_id=?", roomID, txID).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return revision, err
}
func (s *Store) Save(ctx context.Context, r Record, previousRevision int64, commit *document.Commit) error {
	d, b, err := encode(r)
	if err != nil {
		return err
	}
	var payload []byte
	if commit != nil {
		wire, e := json.Marshal(commit)
		if e != nil {
			return e
		}
		var buf bytes.Buffer
		z, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
		if _, e = z.Write(wire); e != nil {
			return e
		}
		if e = z.Close(); e != nil {
			return e
		}
		payload = buf.Bytes()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "UPDATE rooms SET document=?,conflict=?,revision=? WHERE id=? AND revision=?", d, b, r.Document.Revision, r.ID, previousRevision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrConcurrent
	}
	if commit != nil {
		if _, err = tx.ExecContext(ctx, "INSERT INTO receipts(room_id,tx_id,revision,payload) VALUES(?,?,?,?)", r.ID, commit.Transaction.ID, commit.Revision, payload); err != nil {
			return err
		}
		// Permanent compact receipts prevent duplicate execution; only the latest 50
		// canonical messages are kept (compressed on disk) for resumable transport.
		if _, err = tx.ExecContext(ctx, "UPDATE receipts SET payload=NULL WHERE room_id=? AND revision<=? AND payload IS NOT NULL", r.ID, r.Document.Revision-document.Window); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) Delete(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM rooms WHERE id=?", id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return ErrNotFound
	}
	return err
}
func (s *Store) List(ctx context.Context) ([]Metadata, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,code,revision,json_extract(document,'$.updatedAt'),json_extract(document,'$.scheme.name'),json_array_length(json_extract(document,'$.scheme.items')),json_array_length(json_extract(document,'$.scheme.groupOrigins')),json_extract(document,'$.scheme.filePath'),json_extract(document,'$.scheme.lastModified') FROM rooms ORDER BY json_extract(document,'$.updatedAt') DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Metadata{}
	for rows.Next() {
		var m Metadata
		if err = rows.Scan(&m.ObjectID, &m.RoomCode, &m.Revision, &m.UpdatedAt, &m.Scheme.Name, &m.Scheme.ItemCount, &m.Scheme.GroupOriginCount, &m.Scheme.FilePath, &m.Scheme.LastModified); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Replay is bounded by uncompressed bytes, not just number of transactions.
func (s *Store) Replay(ctx context.Context, id string, base, current int64, budget int) ([][]byte, bool, error) {
	if base < 1 || base > current || current-base > document.Window {
		return nil, false, nil
	}
	rows, err := s.db.QueryContext(ctx, "SELECT revision,payload FROM receipts WHERE room_id=? AND revision>? AND revision<=? ORDER BY revision", id, base, current)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	result := [][]byte{}
	expected := base + 1
	for rows.Next() {
		var rev int64
		var data []byte
		if err = rows.Scan(&rev, &data); err != nil {
			return nil, false, err
		}
		if rev != expected || len(data) == 0 {
			return nil, false, nil
		}
		z, e := gzip.NewReader(bytes.NewReader(data))
		if e != nil {
			return nil, false, e
		}
		wire, e := io.ReadAll(io.LimitReader(z, int64(budget)+1))
		z.Close()
		if e != nil {
			return nil, false, e
		}
		if len(wire) > budget {
			return nil, false, nil
		}
		budget -= len(wire)
		result = append(result, wire)
		expected++
	}
	if err = rows.Err(); err != nil {
		return nil, false, err
	}
	return result, expected == current+1, nil
}

// Import performs one all-or-nothing transaction and refuses all overwrites.
func (s *Store) Import(ctx context.Context, input io.Reader) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	decoder := json.NewDecoder(input)
	var header struct {
		Format    string `json:"format"`
		Version   int    `json:"version"`
		RoomCount int    `json:"roomCount"`
	}
	if err = decoder.Decode(&header); err != nil {
		return err
	}
	if header.Format != "buildingmomo-cloud" || header.Version != 1 || header.RoomCount < 0 {
		return errors.New("invalid migration manifest")
	}
	count := 0
	for {
		var e document.Export
		if err = decoder.Decode(&e); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return fmt.Errorf("room %d: %w", count+1, err)
		}
		if e.ObjectID == "" {
			return errors.New("missing objectId")
		}
		if err = document.Normalize(e.Document); err != nil {
			return err
		}
		idx := document.ImportLog(e.Document.Revision, e.TransactionLog)
		if e.Conflict != nil {
			idx = *e.Conflict
		}
		if err = document.ValidateIndex(idx, e.Document.Revision); err != nil {
			return err
		}
		r := Record{e.ObjectID, e.Document, idx}
		d, b, err := encode(r)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO rooms(id,code,document,conflict,revision) VALUES(?,?,?,?,?)", r.ID, r.Document.RoomCode, d, b, r.Document.Revision); err != nil {
			return err
		}
		for _, receipt := range e.Receipts {
			if receipt.Revision < 1 || receipt.Revision > e.Document.Revision || receipt.TransactionID == "" {
				return errors.New("invalid receipt")
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO receipts(room_id,tx_id,revision) VALUES(?,?,?)", r.ID, receipt.TransactionID, receipt.Revision); err != nil {
				return err
			}
		}
		if len(e.Receipts) == 0 {
			for _, entry := range e.TransactionLog {
				if entry.TransactionID != "" {
					if _, err = tx.ExecContext(ctx, "INSERT INTO receipts(room_id,tx_id,revision) VALUES(?,?,?)", r.ID, entry.TransactionID, entry.Revision); err != nil {
						return err
					}
				}
			}
		}
		count++
	}
	if count != header.RoomCount {
		return fmt.Errorf("incomplete migration: expected %d rooms, got %d", header.RoomCount, count)
	}
	return tx.Commit()
}
func (s *Store) Export(ctx context.Context, output io.Writer) error {
	// One consistent read transaction, but only one document at a time in memory.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT id FROM rooms ORDER BY id")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	if err = encoder.Encode(map[string]any{"format": "buildingmomo-cloud", "version": 1, "roomCount": len(ids)}); err != nil {
		return err
	}
	for _, id := range ids {
		var data, index []byte
		if err = tx.QueryRowContext(ctx, "SELECT document,conflict FROM rooms WHERE id=?", id).Scan(&data, &index); err != nil {
			return err
		}
		var e document.Export
		e.ObjectID = id
		if err = json.Unmarshal(data, &e.Document); err != nil {
			return err
		}
		if err = json.Unmarshal(index, &e.Conflict); err != nil {
			return err
		}
		e.Receipts = []document.Receipt{}
		rows, err = tx.QueryContext(ctx, "SELECT tx_id,revision FROM receipts WHERE room_id=? ORDER BY revision", id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var receipt document.Receipt
			if err = rows.Scan(&receipt.TransactionID, &receipt.Revision); err != nil {
				rows.Close()
				return err
			}
			e.Receipts = append(e.Receipts, receipt)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if err = encoder.Encode(e); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Verify checks an imported, offline database against its original migration
// file. Only one document and its compact receipt inventory are hydrated at once.
func (s *Store) Verify(ctx context.Context, input io.Reader) error {
	decoder := json.NewDecoder(input)
	var header struct {
		Format    string `json:"format"`
		Version   int    `json:"version"`
		RoomCount int    `json:"roomCount"`
	}
	if err := decoder.Decode(&header); err != nil {
		return err
	}
	if header.Format != "buildingmomo-cloud" || header.Version != 1 || header.RoomCount < 0 {
		return errors.New("invalid migration manifest")
	}
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM rooms").Scan(&count); err != nil {
		return err
	}
	if count != header.RoomCount {
		return fmt.Errorf("room inventory differs: expected %d, got %d", header.RoomCount, count)
	}
	seen := map[string]bool{}
	for {
		var e document.Export
		if err := decoder.Decode(&e); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return err
		}
		if e.ObjectID == "" || seen[e.ObjectID] {
			return errors.New("missing or duplicate objectId")
		}
		seen[e.ObjectID] = true
		if err := document.Normalize(e.Document); err != nil {
			return err
		}
		index := document.ImportLog(e.Document.Revision, e.TransactionLog)
		if e.Conflict != nil {
			index = *e.Conflict
		}
		actual, err := s.LoadID(ctx, e.ObjectID)
		if err != nil {
			return fmt.Errorf("room %s: %w", e.ObjectID, err)
		}
		wantDoc, wantIndex, err := encode(Record{e.ObjectID, e.Document, index})
		if err != nil {
			return err
		}
		gotDoc, gotIndex, err := encode(actual)
		if err != nil {
			return err
		}
		if !bytes.Equal(wantDoc, gotDoc) || !bytes.Equal(wantIndex, gotIndex) {
			return fmt.Errorf("room %s: document, allocators or conflict index differs", e.Document.RoomCode)
		}
		receipts := map[string]int64{}
		for _, receipt := range e.Receipts {
			receipts[receipt.TransactionID] = receipt.Revision
		}
		if len(e.Receipts) == 0 {
			for _, entry := range e.TransactionLog {
				if entry.TransactionID != "" {
					receipts[entry.TransactionID] = entry.Revision
				}
			}
		}
		rows, err := s.db.QueryContext(ctx, "SELECT tx_id,revision FROM receipts WHERE room_id=?", e.ObjectID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			var revision int64
			if err = rows.Scan(&id, &revision); err != nil {
				rows.Close()
				return err
			}
			if expected, ok := receipts[id]; !ok || expected != revision {
				rows.Close()
				return fmt.Errorf("room %s: receipt differs", e.Document.RoomCode)
			}
			delete(receipts, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(receipts) != 0 {
			return fmt.Errorf("room %s: missing receipts", e.Document.RoomCode)
		}
	}
	if len(seen) != header.RoomCount {
		return errors.New("incomplete migration manifest")
	}
	return nil
}

func (s *Store) Backup(ctx context.Context, path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if _, err = os.Stat(abs); !os.IsNotExist(err) {
		return errors.New("backup destination must not exist")
	}
	f, err := os.CreateTemp(filepath.Dir(abs), ".momo-backup-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err = f.Close(); err != nil {
		return err
	}
	if _, err = s.db.ExecContext(ctx, "VACUUM INTO ?", temp); err != nil {
		return err
	}
	f, err = os.OpenFile(temp, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Link(temp, abs)
}
