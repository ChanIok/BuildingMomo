package room

import (
	"buildingmomo/server/internal/storage"
	"context"
	"errors"
	"testing"
	"time"
)

func TestStaleAdminIdentityCannotAffectRecreatedRoom(t *testing.T) {
	r := &Room{record: storage.Record{ID: "new-room"}}
	if err := r.Delete(context.Background(), "old-room"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("stale delete was allowed", err)
	}
	if err := r.Rename(context.Background(), "old-room", "Wrong room"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("stale rename was allowed", err)
	}
}

func TestSharedFrameBudgetAndRelease(t *testing.T) {
	m := New(nil, time.Minute)
	wire := make([]byte, 1<<20)
	frame := m.frame(wire)
	if frame == nil || m.queued.Load() != 1<<20 {
		t.Fatal("frame not accounted")
	}
	frame.refs.Add(4)
	for i := 0; i < 4; i++ {
		frame.release()
	}
	if m.queued.Load() != 1<<20 {
		t.Fatal("shared frame released early")
	}
	frame.release()
	if m.queued.Load() != 0 {
		t.Fatal("frame leaked")
	}
	m.queued.Store(queueBudget)
	if m.frame([]byte("x")) != nil {
		t.Fatal("unbounded outgoing frames")
	}
}
func TestIdleEvictionRespectsLeasesAndBudget(t *testing.T) {
	m := New(nil, time.Hour)
	now := time.Now()
	a, b := &Room{lastUsed: now.Add(-time.Minute)}, &Room{lastUsed: now, leases: 1}
	a.cost.Store(40 << 20)
	b.cost.Store(40 << 20)
	m.rooms["old"], m.rooms["active"] = a, b
	m.evictIdle(now)
	if m.rooms["old"] != nil || m.rooms["active"] != b {
		t.Fatal("bad cache owner eviction")
	}
	b.leases = 0
	m.evictIdle(now.Add(2 * time.Hour))
	if len(m.rooms) != 0 {
		t.Fatal("idle room retained")
	}
}
