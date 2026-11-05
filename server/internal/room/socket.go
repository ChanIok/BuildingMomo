package room

import (
	"buildingmomo/server/internal/document"
	"buildingmomo/server/internal/storage"
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Frame struct {
	wire  []byte
	refs  atomic.Int32
	owner *Manager
}

func (m *Manager) frame(wire []byte) *Frame {
	size := int64(len(wire))
	for {
		current := m.queued.Load()
		if current+size > queueBudget {
			return nil
		}
		if m.queued.CompareAndSwap(current, current+size) {
			break
		}
	}
	f := &Frame{wire: wire, owner: m}
	f.refs.Store(1)
	return f
}
func (f *Frame) release() {
	if f.refs.Add(-1) == 0 {
		f.owner.queued.Add(-int64(len(f.wire)))
	}
}

type User struct {
	ClientID    string `json:"clientId"`
	DisplayName string `json:"displayName"`
	ConnectedAt int64  `json:"connectedAt"`
}
type Peer struct {
	mu      sync.Mutex
	stopped bool
	conn    *websocket.Conn
	ctx     context.Context
	cancel  context.CancelFunc
	queue   chan *Frame
	User    User
}

func (p *Peer) Stop() {
	p.mu.Lock()
	if !p.stopped {
		p.stopped = true
		p.cancel()
		p.conn.CloseNow()
	}
	p.mu.Unlock()
}
func (p *Peer) enqueue(f *Frame) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stopped {
		return
	}
	f.refs.Add(1)
	select {
	case p.queue <- f:
	default:
		f.release()
		p.stopped = true
		p.cancel()
		p.conn.CloseNow()
	}
}
func (p *Peer) write() {
	defer func() {
		p.Stop()
		for {
			select {
			case f := <-p.queue:
				f.release()
			default:
				return
			}
		}
	}()
	ping := time.NewTicker(120 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case f := <-p.queue:
			ctx, cancel := context.WithTimeout(p.ctx, 120*time.Second)
			err := p.conn.Write(ctx, websocket.MessageText, f.wire)
			cancel()
			f.release()
			if err != nil {
				return
			}
		case <-ping.C:
			ctx, cancel := context.WithTimeout(p.ctx, 10*time.Second)
			err := p.conn.Ping(ctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
func (r *Room) presence() {
	users := []User{}
	for _, p := range r.peers {
		users = append(users, p.User)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].ConnectedAt < users[j].ConnectedAt })
	r.broadcast(map[string]any{"type": "presence", "users": users})
}

// Attach enqueues hello/snapshot or bounded replay before any later commit.
func (r *Room) Attach(ctx context.Context, conn *websocket.Conn, id, name string, resume *int64) error {
	peerCtx, cancel := context.WithCancel(ctx)
	p := &Peer{conn: conn, ctx: peerCtx, cancel: cancel, queue: make(chan *Frame, 64), User: User{id, name, time.Now().UnixMilli()}}
	done := make(chan struct{})
	go func() { p.write(); close(done) }()
	defer func() {
		p.Stop()
		<-done
		r.mu.Lock()
		if r.peers[id] == p {
			delete(r.peers, id)
			r.presence()
		}
		r.mu.Unlock()
	}()
	r.mu.Lock()
	if r.retired.Load() {
		r.mu.Unlock()
		return ErrDraining
	}
	if r.deleted {
		r.mu.Unlock()
		cancel()
		return storage.ErrNotFound
	}
	if old := r.peers[id]; old != nil {
		old.Stop()
	}
	if len(r.peers) >= 16 && r.peers[id] == nil {
		r.mu.Unlock()
		cancel()
		return errors.New("room connection limit reached")
	}
	r.peers[id] = p
	r.send(p, map[string]any{"type": "hello", "collectionTreeVersion": 3, "recoveryVersion": 1, "roomCode": r.record.Document.RoomCode, "revision": r.record.Document.Revision})
	replayed := false
	if resume != nil {
		frames, ok, err := r.owner.store.Replay(ctx, r.record.ID, *resume, r.record.Document.Revision, replayBudget)
		if err != nil {
			delete(r.peers, id)
			r.mu.Unlock()
			p.Stop()
			return err
		}
		if ok {
			for _, wire := range frames {
				r.sendBytes(p, wire)
			}
			r.send(p, map[string]any{"type": "resumed", "revision": r.record.Document.Revision})
			replayed = true
		}
	}
	if !replayed {
		r.send(p, map[string]any{"type": "snapshot", "document": r.record.Document})
	}
	r.presence()
	r.mu.Unlock()
	conn.SetReadLimit(MaxMessageBytes)
	for {
		kind, raw, err := conn.Read(peerCtx)
		if err != nil {
			return nil
		}
		if kind != websocket.MessageText {
			return errors.New("expected text message")
		}
		if err = r.Push(peerCtx, p, raw); err != nil {
			if errors.Is(err, document.ErrInvalid) {
				_ = conn.Close(websocket.StatusPolicyViolation, "Invalid transaction; local edits retained")
				return err
			}
			// The commit path publishes nothing on failure. Close and let the client
			// reconcile against durable state instead of leaving a stuck in-flight edit.
			wire, _ := json.Marshal(map[string]any{"type": "error", "message": "Cloud submission failed; reconnecting"})
			r.mu.Lock()
			r.sendBytes(p, wire)
			r.mu.Unlock()
			return err
		}
	}
}
