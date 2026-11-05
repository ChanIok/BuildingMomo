package httpapi

import (
	"buildingmomo/server/internal/document"
	"buildingmomo/server/internal/room"
	"buildingmomo/server/internal/storage"
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	Config  Config
	Store   *storage.Store
	Rooms   *room.Manager
	login   limiter
	sockets chan struct{}
}

func New(c Config, s *storage.Store, m *room.Manager) *Server {
	return &Server{Config: c, Store: s, Rooms: m, sockets: make(chan struct{}, 8)}
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Debug("response ended", "error", err)
	}
}
func failure(w http.ResponseWriter, err error) {
	status, message := http.StatusServiceUnavailable, "Cloud service unavailable"
	switch {
	case errors.Is(err, storage.ErrNotFound):
		status, message = 404, err.Error()
	case errors.Is(err, storage.ErrExists):
		status, message = 409, err.Error()
	case errors.Is(err, document.ErrInvalid):
		status, message = 400, err.Error()
	case errors.Is(err, room.ErrDraining):
		status, message = 503, err.Error()
	default:
		slog.Error("cloud request failed", "error", err)
	}
	reply(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, room.MaxMessageBytes))
	if err := decoder.Decode(v); err != nil {
		return document.ErrInvalid
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return document.ErrInvalid
	}
	return nil
}
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.Config.expiry(r); !ok {
			reply(w, 403, map[string]string{"error": "Authentication required"})
			return
		}
		if !s.Config.originOK(r) {
			reply(w, 403, map[string]string{"error": "Origin not allowed"})
			return
		}
		next(w, r)
	}
}
func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.Config.admin(r) {
			reply(w, 403, map[string]string{"error": "Admin authorization required"})
			return
		}
		next(w, r)
	}
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := s.Store.Ping(ctx); err != nil {
			reply(w, 503, map[string]bool{"ok": false})
			return
		}
		reply(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		if !s.Config.originOK(r) {
			reply(w, 403, map[string]bool{"success": false})
			return
		}
		if !s.login.allow(r) {
			w.Header().Set("Retry-After", "60")
			reply(w, 429, map[string]any{"success": false, "error": "Too many login attempts"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var body struct {
			Password string `json:"password"`
		}
		if err := decode(w, r, &body); err != nil || body.Password == "" {
			reply(w, 400, map[string]any{"success": false, "error": "Password required"})
			return
		}
		if !s.Config.passwordOK(body.Password) {
			reply(w, 401, map[string]any{"success": false, "error": "Invalid password"})
			return
		}
		http.SetCookie(w, s.Config.cookie(time.Now()))
		reply(w, 200, map[string]bool{"success": true})
	})
	mux.HandleFunc("GET /internal/auth", s.auth(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(204)
	}))
	mux.HandleFunc("POST /api/cloud-schemes", s.auth(s.create))
	mux.HandleFunc("POST /api/cloud-schemes/join", s.auth(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RoomCode string `json:"roomCode"`
		}
		if err := decode(w, r, &body); err != nil {
			failure(w, err)
			return
		}
		err := s.Rooms.With(r.Context(), strings.TrimSpace(body.RoomCode), func(value *room.Room) error {
			d, err := value.Snapshot()
			if err == nil {
				reply(w, 200, map[string]any{"document": d})
			}
			return err
		})
		if err != nil {
			failure(w, err)
		}
	}))
	mux.HandleFunc("GET /api/cloud-schemes/ws", s.auth(s.socket))
	mux.HandleFunc("GET /api/cloud-schemes/admin/list", s.admin(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Store.List(r.Context())
		if err != nil {
			failure(w, err)
			return
		}
		reply(w, 200, map[string]any{"schemes": list})
	}))
	mux.HandleFunc("GET /api/cloud-schemes/admin/meta", s.admin(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Store.List(r.Context())
		if err != nil {
			failure(w, err)
			return
		}
		for _, m := range list {
			if m.ObjectID == r.URL.Query().Get("objectId") {
				reply(w, 200, m)
				return
			}
		}
		failure(w, storage.ErrNotFound)
	}))
	mux.HandleFunc("POST /api/cloud-schemes/admin/delete", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ObjectID string `json:"objectId"`
		}
		if err := decode(w, r, &body); err != nil {
			failure(w, err)
			return
		}
		record, err := s.Store.LoadID(r.Context(), body.ObjectID)
		if err == nil {
			err = s.Rooms.With(r.Context(), record.Document.RoomCode, func(value *room.Room) error { return value.Delete(r.Context(), body.ObjectID) })
		}
		if err != nil {
			failure(w, err)
			return
		}
		reply(w, 200, map[string]any{"ok": true, "deletedRoomCode": record.Document.RoomCode})
	}))
	mux.HandleFunc("POST /api/cloud-schemes/admin/scheme-name", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ObjectID string `json:"objectId"`
			Name     string `json:"name"`
		}
		if err := decode(w, r, &body); err != nil {
			failure(w, err)
			return
		}
		record, err := s.Store.LoadID(r.Context(), body.ObjectID)
		if err == nil {
			err = s.Rooms.With(r.Context(), record.Document.RoomCode, func(value *room.Room) error {
				return value.Rename(r.Context(), body.ObjectID, strings.TrimSpace(body.Name))
			})
		}
		if err != nil {
			failure(w, err)
			return
		}
		reply(w, 200, map[string]any{"ok": true, "name": strings.TrimSpace(body.Name)})
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			controller := http.NewResponseController(w)
			_ = controller.SetReadDeadline(time.Now().Add(2 * time.Minute))
			_ = controller.SetWriteDeadline(time.Now().Add(2 * time.Minute))
		}
		mux.ServeHTTP(w, r)
	})
}

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func code() string {
	random := room.ID()
	var out strings.Builder
	for i := 0; i < 6; i++ {
		v, _ := strconv.ParseUint(random[i*2:i*2+2], 16, 8)
		out.WriteByte(alphabet[int(v)%len(alphabet)])
	}
	return out.String()
}
func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RoomCode string            `json:"roomCode"`
		Snapshot document.Snapshot `json:"snapshot"`
	}
	if err := decode(w, r, &body); err != nil {
		failure(w, err)
		return
	}
	requested := strings.TrimSpace(body.RoomCode)
	for attempt := 0; attempt < 8; attempt++ {
		roomCode := requested
		if roomCode == "" {
			roomCode = code()
		}
		d := &document.Document{RoomCode: roomCode, Revision: 1, UpdatedAt: time.Now().UnixMilli(), Scheme: body.Snapshot}
		saved, err := s.Rooms.Create(r.Context(), d)
		if errors.Is(err, storage.ErrExists) && requested == "" {
			continue
		}
		if err != nil {
			failure(w, err)
			return
		}
		reply(w, 200, map[string]any{"roomCode": roomCode, "document": saved})
		return
	}
	reply(w, 503, map[string]string{"error": "Failed to allocate room code"})
}
func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code, id, name := strings.TrimSpace(q.Get("code")), q.Get("clientId"), strings.TrimSpace(q.Get("displayName"))
	if code == "" || id == "" || name == "" || document.StringLength(id) > 200 || document.StringLength(name) > 200 {
		reply(w, 400, map[string]string{"error": "Missing or invalid room code, clientId, or displayName"})
		return
	}
	if q.Get("collectionTreeVersion") != "3" {
		reply(w, 426, map[string]string{"error": "Update the editor to use collection trees"})
		return
	}
	// Explicit Origin is required for browser WebSocket handshakes.
	if r.Header.Get("Origin") != s.Config.Origin {
		reply(w, 403, map[string]string{"error": "Origin not allowed"})
		return
	}
	select {
	case s.sockets <- struct{}{}:
		defer func() { <-s.sockets }()
	default:
		reply(w, 503, map[string]string{"error": "Connection limit reached"})
		return
	}
	var resume *int64
	if raw := q.Get("resumeRevision"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			reply(w, 400, map[string]string{"error": "Invalid resume revision"})
			return
		}
		resume = &value
	}
	upgraded := false
	err := s.Rooms.With(r.Context(), code, func(value *room.Room) error {
		if _, err := value.Snapshot(); err != nil {
			return err
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
		if err != nil {
			return err
		}
		upgraded = true
		defer conn.CloseNow()
		expires, _ := s.Config.expiry(r)
		ctx, cancel := context.WithDeadline(r.Context(), expires)
		defer cancel()
		return value.Attach(ctx, conn, id, name, resume)
	})
	if err != nil {
		if !upgraded {
			failure(w, err)
		} else {
			slog.Warn("cloud websocket ended", "error", err)
		}
	}
}
