// Package room owns room lifetimes, commit ordering and bounded WS delivery.
package room

import (
	"buildingmomo/server/internal/document"
	"buildingmomo/server/internal/storage"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const MaxMessageBytes int64 = 64 << 20
const queueBudget int64 = 128 << 20
const replayBudget = 8 << 20

var ErrDraining = errors.New("server is shutting down")

type Manager struct {
	mu      sync.Mutex
	store   *storage.Store
	rooms   map[string]*Room
	idle    time.Duration
	closed  bool
	writers sync.Mutex
	queued  atomic.Int64
	wg      sync.WaitGroup
}
type Room struct {
	mu       sync.Mutex
	owner    *Manager
	record   storage.Record
	peers    map[string]*Peer
	lastUsed time.Time
	deleted  bool
	retired  atomic.Bool
	leases   int
	cost     atomic.Int64
}

func New(store *storage.Store, idle time.Duration) *Manager {
	return &Manager{store: store, rooms: map[string]*Room{}, idle: idle}
}
func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (m *Manager) With(ctx context.Context, code string, fn func(*Room) error) error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return ErrDraining
	}
	r := m.rooms[code]
	if r != nil && r.retired.Load() {
		delete(m.rooms, code)
		r = nil
	}
	if r == nil {
		record, err := m.store.Load(ctx, code)
		if err != nil {
			m.mu.Unlock()
			return err
		}
		r = &Room{owner: m, record: record, peers: map[string]*Peer{}, lastUsed: time.Now()}
		r.cost.Store(estimate(r.record))
		m.rooms[code] = r
	}
	r.leases++
	m.evictIdle(time.Now())
	m.wg.Add(1)
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		r.leases--
		r.lastUsed = time.Now()
		m.evictIdle(time.Now())
		m.mu.Unlock()
		m.wg.Done()
	}()
	return fn(r)
}
func (m *Manager) Create(ctx context.Context, d *document.Document) (*document.Document, error) {
	if err := document.Normalize(d); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrDraining
	}
	r := storage.Record{ID: ID(), Document: d, Index: document.NewIndex(d.Revision)}
	if err := m.store.Create(ctx, r); err != nil {
		return nil, err
	}
	delete(m.rooms, d.RoomCode)
	return d, nil
}
func (m *Manager) Sweep(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			m.mu.Lock()
			m.evictIdle(now)
			m.mu.Unlock()
		}
	}
}
func (m *Manager) Close(ctx context.Context) error {
	m.mu.Lock()
	m.closed = true
	rooms := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		rooms = append(rooms, r)
	}
	m.mu.Unlock()
	for _, r := range rooms {
		r.mu.Lock()
		for _, p := range r.peers {
			p.Stop()
		}
		r.mu.Unlock()
	}
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (r *Room) Snapshot() (*document.Document, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired.Load() {
		return nil, ErrDraining
	}
	if r.deleted {
		return nil, storage.ErrNotFound
	}
	return r.record.Document, nil
}
func (r *Room) Rename(ctx context.Context, expectedID, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired.Load() {
		return ErrDraining
	}
	if r.deleted || r.record.ID != expectedID {
		return storage.ErrNotFound
	}
	if strings.TrimSpace(name) == "" || document.StringLength(name) > 200 {
		return document.ErrInvalid
	}
	candidate := *r.record.Document
	candidate.Scheme.Name = name
	candidate.UpdatedAt = time.Now().UnixMilli()
	if err := document.Normalize(&candidate); err != nil {
		return err
	}
	next := r.record
	next.Document = &candidate
	if err := r.owner.store.Save(ctx, next, r.record.Document.Revision, nil); err != nil {
		r.retire()
		return err
	}
	r.record = next
	r.cost.Store(estimate(next))
	r.broadcast(map[string]any{"type": "scheme_name", "roomCode": candidate.RoomCode, "name": name})
	return nil
}
func (r *Room) Delete(ctx context.Context, expectedID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired.Load() {
		return ErrDraining
	}
	if r.deleted || r.record.ID != expectedID {
		return storage.ErrNotFound
	}
	if err := r.owner.store.Delete(ctx, r.record.ID); err != nil {
		r.retire()
		return err
	}
	r.deleted = true
	for _, p := range r.peers {
		p.Stop()
	}
	return nil
}
func (r *Room) Push(ctx context.Context, peer *Peer, raw []byte) error {
	clientID := peer.User.ClientID
	// Serialise large decodes/commits across rooms on the 1-core target as well as
	// within each room. Incoming Reader limits are enforced before this allocation.
	r.owner.writers.Lock()
	defer r.owner.writers.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired.Load() {
		return ErrDraining
	}
	if r.deleted {
		return storage.ErrNotFound
	}
	var p document.Push
	if err := json.Unmarshal(raw, &p); err != nil {
		return document.ErrInvalid
	}
	if r.peers[clientID] != peer {
		return errors.New("connection no longer active")
	}
	if p.Type != "push_tx" || p.Transaction.ID == "" {
		return document.ErrInvalid
	}
	p.Transaction.SchemeID = r.record.Document.RoomCode
	revision, err := r.owner.store.Receipt(ctx, r.record.ID, p.Transaction.ID)
	if err != nil {
		return err
	}
	if revision > 0 {
		r.send(peer, map[string]any{"type": "tx_ack", "transactionId": p.Transaction.ID, "committedRevision": revision})
		return nil
	}
	d, idx, tx, err := document.Prepare(r.record.Document, r.record.Index, p, time.Now().UnixMilli())
	if errors.Is(err, document.ErrConflict) {
		r.send(peer, map[string]any{"type": "reset", "reason": "version_mismatch", "document": r.record.Document})
		return nil
	}
	if err != nil {
		return err
	}
	commit := document.Commit{Type: "tx_committed", Revision: d.Revision, AuthorClientID: clientID, Transaction: tx}
	next := storage.Record{ID: r.record.ID, Document: d, Index: idx}
	if err = r.owner.store.Save(ctx, next, r.record.Document.Revision, &commit); err != nil {
		r.retire()
		return err
	}
	r.record = next
	r.cost.Store(estimate(next))
	r.broadcast(commit)
	return nil
}
func (r *Room) broadcast(value any) {
	wire, err := json.Marshal(value)
	if err != nil {
		for _, p := range r.peers {
			p.Stop()
		}
		return
	}
	r.broadcastBytes(wire)
}
func (r *Room) broadcastBytes(wire []byte) {
	f := r.owner.frame(wire)
	if f == nil {
		for _, p := range r.peers {
			p.Stop()
		}
		return
	}
	defer f.release()
	for _, p := range r.peers {
		p.enqueue(f)
	}
}
func (r *Room) send(p *Peer, value any) {
	wire, err := json.Marshal(value)
	if err != nil {
		p.Stop()
		return
	}
	r.sendBytes(p, wire)
}
func (r *Room) sendBytes(p *Peer, wire []byte) {
	f := r.owner.frame(wire)
	if f == nil {
		p.Stop()
		return
	}
	p.enqueue(f)
	f.release()
}

// Account for object bodies and opaque JSON, not just the number of rooms.
// This is an eviction estimate; GOMEMLIMIT and service limits remain separate.
func estimate(r storage.Record) int64 {
	cost := int64(4096)
	for _, i := range r.Document.Scheme.Items {
		cost += int64(256 + len(i.InternalID) + len(i.Extra))
	}
	for id := range r.Index.Touched {
		cost += int64(64 + len(id))
	}
	for _, n := range r.Document.Scheme.CollectionTree.Nodes {
		cost += int64(128 + len(n.ID) + len(n.Name))
	}
	cost += int64(len(r.Document.Scheme.CollectionTree.Groups)) * 128
	return cost
}

// m.mu is held. Active leases may not be evicted, even under memory pressure.
func (m *Manager) evictIdle(now time.Time) {
	var total int64
	for code, r := range m.rooms {
		if r.leases == 0 && now.Sub(r.lastUsed) >= m.idle {
			delete(m.rooms, code)
		} else {
			total += r.cost.Load()
		}
	}
	for total > 64<<20 {
		var oldest *Room
		var key string
		for code, r := range m.rooms {
			if r.leases == 0 && (oldest == nil || r.lastUsed.Before(oldest.lastUsed)) {
				oldest, key = r, code
			}
		}
		if oldest == nil {
			return
		}
		total -= oldest.cost.Load()
		delete(m.rooms, key)
	}
}

// An I/O/commit error may have an uncertain durable outcome. No old in-memory
// state may accept another edit until SQLite has been read again.
func (r *Room) retire() {
	r.retired.Store(true)
	for _, p := range r.peers {
		p.Stop()
	}
}
