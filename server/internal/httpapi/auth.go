package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const cookieName = "momo_session"
const cookieLifetime = 3 * 24 * time.Hour

type Config struct {
	Origin     string
	SessionKey []byte
	Passwords  []string
	AdminToken string
	Secure     bool
}

func ConfigFromEnv() (Config, error) {
	c := Config{Origin: strings.TrimRight(os.Getenv("MOMO_PUBLIC_ORIGIN"), "/"), SessionKey: []byte(os.Getenv("MOMO_SESSION_KEY")), AdminToken: os.Getenv("MOMO_ADMIN_TOKEN")}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("MOMO_PUBLIC_ORIGIN must be an origin such as https://example.com")
	}
	c.Secure = u.Scheme == "https"
	if !c.Secure && (u.Scheme != "http" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1")) {
		return c, errors.New("public origin must use HTTPS")
	}
	if len(c.SessionKey) < 32 {
		return c, errors.New("MOMO_SESSION_KEY must contain at least 32 bytes")
	}
	if len(c.AdminToken) < 24 {
		return c, errors.New("MOMO_ADMIN_TOKEN must contain at least 24 bytes")
	}
	if err = json.Unmarshal([]byte(os.Getenv("MOMO_PASSWORDS")), &c.Passwords); err != nil || len(c.Passwords) == 0 {
		return c, errors.New("MOMO_PASSWORDS must be a nonempty JSON array")
	}
	for _, p := range c.Passwords {
		if p == "" {
			return c, errors.New("empty access password")
		}
	}
	return c, nil
}
func (c Config) signature(payload string) string {
	m := hmac.New(sha256.New, c.SessionKey)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func (c Config) cookie(now time.Time) *http.Cookie {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		panic(err)
	}
	payload := strconv.FormatInt(now.Add(cookieLifetime).Unix(), 10) + "." + hex.EncodeToString(nonce[:])
	return &http.Cookie{Name: cookieName, Value: payload + "." + c.signature(payload), Path: "/", MaxAge: int(cookieLifetime.Seconds()), HttpOnly: true, Secure: c.Secure, SameSite: http.SameSiteStrictMode}
}
func (c Config) expiry(r *http.Request) (time.Time, bool) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return time.Time{}, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	payload := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(c.signature(payload))) {
		return time.Time{}, false
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || expires <= time.Now().Unix() {
		return time.Time{}, false
	}
	return time.Unix(expires, 0), true
}
func (c Config) originOK(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || origin == c.Origin
}
func (c Config) admin(r *http.Request) bool {
	token := ""
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	}
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Cloud-Admin-Token"))
	}
	return len(c.AdminToken) > 0 && len(token) == len(c.AdminToken) && subtle.ConstantTimeCompare([]byte(token), []byte(c.AdminToken)) == 1
}
func (c Config) passwordOK(password string) bool {
	valid := 0
	for _, p := range c.Passwords {
		a, b := sha256.Sum256([]byte(password)), sha256.Sum256([]byte(p))
		valid |= subtle.ConstantTimeCompare(a[:], b[:])
	}
	return valid == 1
}

type attempt struct {
	Start time.Time
	Count int
}
type limiter struct {
	mu       sync.Mutex
	attempts map[string]attempt
}

func (l *limiter) allow(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	// Only our loopback reverse proxy may supply the client address.
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			host = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.attempts == nil {
		l.attempts = map[string]attempt{}
	}
	for key, a := range l.attempts {
		if now.Sub(a.Start) > time.Minute {
			delete(l.attempts, key)
		}
	}
	a := l.attempts[host]
	if a.Start.IsZero() {
		a.Start = now
	}
	a.Count++
	l.attempts[host] = a
	return a.Count <= 10
}
