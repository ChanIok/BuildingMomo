package httpapi

import (
	"buildingmomo/server/internal/document"
	"buildingmomo/server/internal/room"
	"buildingmomo/server/internal/storage"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fixture struct {
	path   string
	api    *Server
	http   *httptest.Server
	store  *storage.Store
	cookie *http.Cookie
}

func setup(t *testing.T) *fixture {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.sqlite")
	store, err := storage.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	config := Config{Origin: "http://momo.test", SessionKey: bytes.Repeat([]byte("k"), 32), Passwords: []string{"test-password"}, AdminToken: strings.Repeat("a", 24)}
	manager := room.New(store, time.Millisecond)
	api := New(config, store, manager)
	server := httptest.NewServer(api.Handler())
	f := &fixture{api: api, http: server, store: store, path: path}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			t.Error(err)
		}
		server.Close()
		store.Close()
	})
	response := f.post(t, "/api/login", map[string]string{"password": "test-password"}, false)
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
	f.cookie = response.Cookies()[0]
	return f
}
func (f *fixture) post(t *testing.T, path string, value any, authenticated bool) *http.Response {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest("POST", f.http.URL+path, bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", f.api.Config.Origin)
	if authenticated {
		req.AddCookie(f.cookie)
	}
	res, err := f.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}
func (f *fixture) create(t *testing.T) {
	res := f.post(t, "/api/cloud-schemes", map[string]any{"roomCode": "room", "snapshot": document.Snapshot{Name: "Test", Items: []*document.Item{{InternalID: "a", InstanceID: 1000, GameID: 1, Extra: json.RawMessage(`{"Scale":{"X":1,"Y":1,"Z":1}}`)}}, GroupOrigins: []document.Pair{}, CollectionTree: document.EmptyTree()}}, true)
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.Status)
	}
}
func (f *fixture) dial(t *testing.T, id string, resume string) *websocket.Conn {
	t.Helper()
	u := strings.Replace(f.http.URL, "http:", "ws:", 1) + "/api/cloud-schemes/ws?code=room&clientId=" + id + "&displayName=Tester&collectionTreeVersion=3"
	if resume != "" {
		u += "&resumeRevision=" + resume
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, u, &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {f.cookie.String()}, "Origin": {f.api.Config.Origin}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return conn
}
func receive(t *testing.T, c *websocket.Conn, kind string) map[string]json.RawMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		var value map[string]json.RawMessage
		if err := wsjson.Read(ctx, c, &value); err != nil {
			t.Fatal(err)
		}
		var got string
		_ = json.Unmarshal(value["type"], &got)
		if got == kind {
			return value
		}
	}
}
func send(t *testing.T, c *websocket.Conn, p document.Push) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, c, p); err != nil {
		t.Fatal(err)
	}
}
func motion(d *document.Document, id string, x float64) document.Push {
	before := d.Scheme.Items[0]
	after := *before
	after.X = x
	return document.Push{Type: "push_tx", BaseRevision: d.Revision, Transaction: document.Transaction{ID: id, SchemeID: "room", CreatedAt: 1, Intent: "move", Ops: []document.Operation{{Type: "patch_items", Changes: []document.Change{{ItemID: before.InternalID, Before: before, After: &after}}}}}}
}
func TestAuthenticationAndWebSocketOrigin(t *testing.T) {
	f := setup(t)
	res := f.post(t, "/api/cloud-schemes/join", map[string]string{"roomCode": "room"}, false)
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("unauthenticated request accepted")
	}
	res = f.post(t, "/api/login", map[string]string{"password": "wrong"}, false)
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("bad password accepted")
	}
	req, _ := http.NewRequest("GET", f.http.URL+"/internal/auth", nil)
	req.Header.Set("Cookie", "momo_session=evil"+f.cookie.Value)
	res, err := f.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("substring cookie accepted")
	}
	f.create(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(ctx, strings.Replace(f.http.URL, "http:", "ws:", 1)+"/api/cloud-schemes/ws?code=room&clientId=a&displayName=x&collectionTreeVersion=3", &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {f.cookie.String()}, "Origin": {"http://evil.test"}}})
	if conn != nil {
		conn.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != 403 {
		t.Fatal("cross-origin websocket accepted", err)
	}
}
func TestDurableBroadcastIdempotencyAndResume(t *testing.T) {
	f := setup(t)
	f.create(t)
	a := f.dial(t, "a", "")
	receive(t, a, "hello")
	receive(t, a, "snapshot")
	b := f.dial(t, "b", "")
	receive(t, b, "snapshot")
	r, err := f.store.Load(context.Background(), "room")
	if err != nil {
		t.Fatal(err)
	}
	push := motion(r.Document, "first", 42)
	send(t, a, push)
	receive(t, a, "tx_committed")
	receive(t, b, "tx_committed")
	send(t, a, push)
	ack := receive(t, a, "tx_ack")
	if string(ack["committedRevision"]) != "2" {
		t.Fatal("bad duplicate receipt")
	}
	r, err = f.store.Load(context.Background(), "room")
	if err != nil || r.Document.Revision != 2 || r.Document.Scheme.Items[0].X != 42 {
		t.Fatal("duplicate execution", err)
	}
	a.CloseNow()
	resumed := f.dial(t, "a", "1")
	hello := receive(t, resumed, "hello")
	if string(hello["recoveryVersion"]) != "1" {
		t.Fatal("missing recovery capability")
	}
	commit := receive(t, resumed, "tx_committed")
	if string(commit["revision"]) != "2" {
		t.Fatal("bad replay")
	}
	receive(t, resumed, "resumed")
	fallback := f.dial(t, "c", "0")
	receive(t, fallback, "hello")
	snapshot := receive(t, fallback, "snapshot")
	var restored document.Document
	if err = json.Unmarshal(snapshot["document"], &restored); err != nil || restored.Revision != 2 {
		t.Fatal("fallback snapshot wrong", err)
	}
}
func TestAdminDeleteAndRecreateSameCode(t *testing.T) {
	f := setup(t)
	f.create(t)
	a := f.dial(t, "a", "")
	receive(t, a, "snapshot")
	record, err := f.store.Load(context.Background(), "room")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"objectId": record.ID})
	req, _ := http.NewRequest("POST", f.http.URL+"/api/cloud-schemes/admin/delete", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+f.api.Config.AdminToken)
	res, err := f.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.Status)
	}
	f.create(t)
	b := f.dial(t, "b", "")
	receive(t, b, "snapshot")
	updated, err := f.store.Load(context.Background(), "room")
	if err != nil || updated.ID == record.ID {
		t.Fatal("old room identity reused", err)
	}
	req, _ = http.NewRequest("GET", f.http.URL+"/api/cloud-schemes/admin/meta?objectId="+url.QueryEscape(updated.ID), nil)
	req.Header.Set("X-Cloud-Admin-Token", f.api.Config.AdminToken)
	res, err = f.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.Status)
	}
}

func TestConcurrentRoomsSubmissionsRemainOrdered(t *testing.T) {
	f := setup(t)
	f.create(t)
	clients := make([]*websocket.Conn, 4)
	for i := range clients {
		clients[i] = f.dial(t, fmt.Sprintf("c%d", i), "")
		receive(t, clients[i], "snapshot")
	}
	var wg sync.WaitGroup
	for k, c := range clients {
		wg.Add(1)
		go func(k int, c *websocket.Conn) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			err := wsjson.Write(ctx, c, document.Push{Type: "push_tx", BaseRevision: 1, Transaction: document.Transaction{ID: fmt.Sprintf("add-%d", k), SchemeID: "room", Ops: []document.Operation{{Type: "add_items", Items: []*document.Item{{InternalID: fmt.Sprintf("new-%d", k), InstanceID: 1000, GameID: 1, Extra: json.RawMessage(`{}`)}}}}}})
			if err != nil {
				t.Error(err)
			}
		}(k, c)
	}
	wg.Wait()
	deadline := time.Now().Add(3 * time.Second)
	for {
		r, err := f.store.Load(context.Background(), "room")
		if err != nil {
			t.Fatal(err)
		}
		if r.Document.Revision == 5 {
			seen := map[int64]bool{}
			for _, i := range r.Document.Scheme.Items {
				if seen[i.InstanceID] {
					t.Fatal("duplicate instance ID")
				}
				seen[i.InstanceID] = true
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("lost concurrent submission", r.Document.Revision)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestStorageFailureRetiresRoomBeforeReconnecting(t *testing.T) {
	f := setup(t)
	f.create(t)
	connection := f.dial(t, "a", "")
	receive(t, connection, "snapshot")
	db, err := sql.Open("sqlite", f.path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER fail_update BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT,'injected write failure'); END;`); err != nil {
		t.Fatal(err)
	}
	record, err := f.store.Load(context.Background(), "room")
	if err != nil {
		t.Fatal(err)
	}
	send(t, connection, motion(record.Document, "failed", 42))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, _, err = connection.Read(ctx)
		if err != nil {
			break
		}
	}
	if _, err = db.Exec("DROP TRIGGER fail_update"); err != nil {
		t.Fatal(err)
	}
	record, err = f.store.Load(context.Background(), "room")
	if err != nil || record.Document.Revision != 1 || record.Document.Scheme.Items[0].X != 0 {
		t.Fatal("failed write published", err)
	}
	replacement := f.dial(t, "a", "1")
	receive(t, replacement, "resumed")
	send(t, replacement, motion(record.Document, "retry", 7))
	receive(t, replacement, "tx_committed")
	record, err = f.store.Load(context.Background(), "room")
	if err != nil || record.Document.Revision != 2 || record.Document.Scheme.Items[0].X != 7 {
		t.Fatal("room could not recover", err)
	}
}
