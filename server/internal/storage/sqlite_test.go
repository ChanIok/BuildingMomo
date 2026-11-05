package storage

import (
	"buildingmomo/server/internal/document"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (*Store, Record) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "momo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	d := &document.Document{RoomCode: "test", Revision: 1, Scheme: document.Snapshot{Name: "Test", Items: []*document.Item{}, GroupOrigins: []document.Pair{}, CollectionTree: document.EmptyTree()}}
	if err = document.Normalize(d); err != nil {
		t.Fatal(err)
	}
	r := Record{"object", d, document.NewIndex(1)}
	if err = s.Create(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	return s, r
}
func TestCommitReceiptsExportImportAndBackup(t *testing.T) {
	s, r := fixture(t)
	ctx := context.Background()
	next := *r.Document
	next.Revision = 2
	r.Document = &next
	c := document.Commit{Type: "tx_committed", Revision: 2, AuthorClientID: "actor", Transaction: document.Transaction{ID: "tx", Ops: []document.Operation{}}}
	if err := s.Save(ctx, r, 1, &c); err != nil {
		t.Fatal(err)
	}
	if revision, err := s.Receipt(ctx, r.ID, "tx"); err != nil || revision != 2 {
		t.Fatal(revision, err)
	}
	frames, ok, err := s.Replay(ctx, r.ID, 1, 2, 1<<20)
	if err != nil || !ok || len(frames) != 1 {
		t.Fatal(ok, err)
	}
	if _, ok, err = s.Replay(ctx, r.ID, 1, 2, 1); err != nil || ok {
		t.Fatal("replay budget ignored")
	}
	if err = s.Save(ctx, r, 1, &c); !errors.Is(err, ErrConcurrent) {
		t.Fatal("CAS allowed stale writer", err)
	}
	loaded, err := s.Load(ctx, "test")
	if err != nil || loaded.Document.Revision != 2 {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err = s.Export(ctx, &output); err != nil {
		t.Fatal(err)
	}
	other, err := Open(filepath.Join(t.TempDir(), "import.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = other.Import(ctx, bytes.NewReader(output.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err = other.Verify(ctx, bytes.NewReader(output.Bytes())); err != nil {
		t.Fatal("roundtrip verification failed", err)
	}
	changed := strings.Replace(output.String(), `"nextInstanceId":1000`, `"nextInstanceId":1001`, 1)
	if err = other.Verify(ctx, strings.NewReader(changed)); err == nil {
		t.Fatal("verification missed a changed allocator")
	}
	if _, err = other.db.Exec("DELETE FROM receipts"); err != nil {
		t.Fatal(err)
	}
	if err = other.Verify(ctx, bytes.NewReader(output.Bytes())); err == nil {
		t.Fatal("verification missed a missing receipt")
	}
	if _, err = other.db.Exec("INSERT INTO receipts(room_id,tx_id,revision) VALUES(?,?,?)", r.ID, "tx", 2); err != nil {
		t.Fatal(err)
	}
	if rev, err := other.Receipt(ctx, r.ID, "tx"); err != nil || rev != 2 {
		t.Fatal("receipt missing", err)
	}
	if err = other.Import(ctx, bytes.NewReader(output.Bytes())); err == nil {
		t.Fatal("import overwrote a room")
	}
	backup := filepath.Join(t.TempDir(), "backup.sqlite")
	if err = s.Backup(ctx, backup); err != nil {
		t.Fatal(err)
	}
	copy, err := Open(backup)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	if _, err = copy.Load(ctx, "test"); err != nil {
		t.Fatal(err)
	}
	if err = s.Backup(ctx, backup); err == nil {
		t.Fatal("backup overwrote file")
	}
	if err = s.Delete(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if revision, err := s.Receipt(ctx, r.ID, "tx"); err != nil || revision != 0 {
		t.Fatal("receipt did not cascade")
	}
}
func TestIncompleteImportRollsBack(t *testing.T) {
	s, _ := fixture(t)
	var export bytes.Buffer
	if err := s.Export(context.Background(), &export); err != nil {
		t.Fatal(err)
	}
	input := strings.Replace(export.String(), `"roomCount":1`, `"roomCount":2`, 1)
	other, err := Open(filepath.Join(t.TempDir(), "new.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = other.Import(context.Background(), strings.NewReader(input)); err == nil {
		t.Fatal("accepted incomplete export")
	}
	list, err := other.List(context.Background())
	if err != nil || len(list) != 0 {
		t.Fatal("partial import published", err)
	}
}
func TestLegacyCloudflareImportPreservesDocumentAndConflictHistory(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "legacy.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	d := &document.Document{
		RoomCode: "legacy", Revision: 9, UpdatedAt: 1234, NextInstanceID: 9999, NextGroupID: 500,
		Scheme: document.Snapshot{
			Name: "Existing cloud scheme", Items: []*document.Item{{InternalID: "a", GameID: 1, InstanceID: 1000, Extra: json.RawMessage(`{"Scale":{"X":1,"Y":1,"Z":1},"unknown":9007199254740993}`)}},
			GroupOrigins: []document.Pair{}, CollectionTree: document.EmptyTree(),
		},
	}
	e := document.Export{ObjectID: "old-durable-object-id", Document: d, TransactionLog: []document.LogEntry{
		{Revision: 8, TransactionID: "old-8", CollectionTreeChanged: true, TouchedItemIDs: []string{"a"}},
		{Revision: 9, TransactionID: "old-9", TouchedItemIDs: []string{"a"}},
	}}
	var source bytes.Buffer
	encoder := json.NewEncoder(&source)
	if err = encoder.Encode(map[string]any{"format": "buildingmomo-cloud", "version": 1, "roomCount": 1}); err != nil {
		t.Fatal(err)
	}
	if err = encoder.Encode(e); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = s.Import(ctx, bytes.NewReader(source.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err = s.Verify(ctx, bytes.NewReader(source.Bytes())); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.LoadID(ctx, e.ObjectID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Document.NextInstanceID != 9999 || loaded.Document.NextGroupID != 500 || loaded.Index.Floor != 7 || loaded.Index.LastTree != 8 || loaded.Index.Touched["a"] != 9 {
		t.Fatal("migration changed allocators or conflict history")
	}
	if !strings.Contains(string(loaded.Document.Scheme.Items[0].Extra), "9007199254740993") {
		t.Fatal("unknown number lost precision")
	}
	if rev, err := s.Receipt(ctx, e.ObjectID, "old-8"); err != nil || rev != 8 {
		t.Fatal("old receipt missing", err)
	}
}
func TestFailedCommitDoesNotLeaveReceipt(t *testing.T) {
	s, r := fixture(t)
	ctx := context.Background()
	next := *r.Document
	next.Revision = 2
	r.Document = &next
	// A duplicate receipt makes the second statement fail AFTER the document update.
	if _, err := s.db.Exec("INSERT INTO receipts(room_id,tx_id,revision) VALUES(?,?,?)", r.ID, "tx", 1); err != nil {
		t.Fatal(err)
	}
	commit := document.Commit{Revision: 2, Transaction: document.Transaction{ID: "tx"}}
	if err := s.Save(ctx, r, 1, &commit); err == nil {
		t.Fatal("expected failure")
	}
	loaded, err := s.Load(ctx, "test")
	if err != nil || loaded.Document.Revision != 1 {
		t.Fatal("partial commit", err)
	}
	var value map[string]any
	b, _ := json.Marshal(loaded.Document)
	_ = json.Unmarshal(b, &value)
}
