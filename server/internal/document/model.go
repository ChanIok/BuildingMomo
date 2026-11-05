// Package document implements the wire-compatible, immutable cloud document.
package document

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

const Window int64 = 50
const maxSafeInteger int64 = 9007199254740991

var ErrConflict = errors.New("version_mismatch")
var ErrInvalid = errors.New("invalid cloud data")

type Rotation struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}
type Item struct {
	InternalID string          `json:"internalId"`
	GameID     int64           `json:"gameId"`
	InstanceID int64           `json:"instanceId"`
	X          float64         `json:"x"`
	Y          float64         `json:"y"`
	Z          float64         `json:"z"`
	Rotation   Rotation        `json:"rotation"`
	GroupID    int64           `json:"groupId"`
	Extra      json.RawMessage `json:"extra"`
}
type Node struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ParentID     *string `json:"parentId"`
	Order        float64 `json:"order"`
	OriginItemID *string `json:"originItemId,omitempty"`
}
type Group struct {
	ID           int64   `json:"groupId"`
	Name         *string `json:"name,omitempty"`
	CollectionID *string `json:"collectionId"`
	Order        float64 `json:"order"`
}
type Tree struct {
	Nodes  []Node  `json:"nodes"`
	Groups []Group `json:"groups"`
}

func EmptyTree() Tree { return Tree{Nodes: []Node{}, Groups: []Group{}} }

type Pair struct {
	ID    int64
	Value string
}

func (p Pair) MarshalJSON() ([]byte, error) { return json.Marshal([2]any{p.ID, p.Value}) }
func (p *Pair) UnmarshalJSON(b []byte) error {
	var a []json.RawMessage
	if err := json.Unmarshal(b, &a); err != nil {
		return err
	}
	if len(a) != 2 {
		return errors.New("invalid group entry")
	}
	if err := json.Unmarshal(a[0], &p.ID); err != nil {
		return err
	}
	return json.Unmarshal(a[1], &p.Value)
}

type Snapshot struct {
	Name           string   `json:"name"`
	FilePath       *string  `json:"filePath,omitempty"`
	LastModified   *float64 `json:"lastModified,omitempty"`
	Items          []*Item  `json:"items"`
	CollectionTree Tree     `json:"collectionTree"`
	GroupOrigins   []Pair   `json:"groupOrigins"`
}
type Document struct {
	RoomCode              string   `json:"roomCode"`
	CollectionTreeVersion int      `json:"collectionTreeVersion"`
	Revision              int64    `json:"revision"`
	UpdatedAt             int64    `json:"updatedAt"`
	Scheme                Snapshot `json:"scheme"`
	NextInstanceID        int64    `json:"nextInstanceId"`
	NextGroupID           int64    `json:"nextGroupId"`
}
type Change struct {
	ItemID string `json:"itemId"`
	Before *Item  `json:"before"`
	After  *Item  `json:"after"`
}
type Operation struct {
	Type    string          `json:"type"`
	Changes []Change        `json:"changes,omitempty"`
	Items   []*Item         `json:"items,omitempty"`
	Before  json.RawMessage `json:"before,omitempty"`
	After   json.RawMessage `json:"after,omitempty"`
}
type Transaction struct {
	ID        string      `json:"id"`
	SchemeID  string      `json:"schemeId"`
	CreatedAt int64       `json:"createdAt"`
	Intent    string      `json:"intent"`
	Ops       []Operation `json:"ops"`
}
type Push struct {
	Type         string      `json:"type"`
	BaseRevision int64       `json:"baseRevision"`
	Transaction  Transaction `json:"transaction"`
}
type Commit struct {
	Type           string      `json:"type"`
	Revision       int64       `json:"revision"`
	AuthorClientID string      `json:"authorClientId"`
	Transaction    Transaction `json:"transaction"`
}

// Index preserves the last-50-revisions conflict rule without repeated UUID lists.
// Deleted IDs are retained until they leave the replay window.
type Index struct {
	Floor    int64            `json:"floor"`
	LastTree int64            `json:"lastTree"`
	Touched  map[string]int64 `json:"touched"`
}
type LogEntry struct {
	Revision              int64    `json:"revision"`
	TransactionID         string   `json:"transactionId"`
	CollectionTreeChanged bool     `json:"collectionTreeChanged"`
	TouchedItemIDs        []string `json:"touchedItemIds"`
}
type Export struct {
	Receipts       []Receipt  `json:"receipts,omitempty"`
	ObjectID       string     `json:"objectId"`
	Document       *Document  `json:"document"`
	Conflict       *Index     `json:"conflict,omitempty"`
	TransactionLog []LogEntry `json:"transactionLog,omitempty"`
}

func StringLength(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}
func validName(s string) bool { return strings.TrimSpace(s) != "" && StringLength(s) <= 200 }
func finite(n float64) bool   { return !math.IsNaN(n) && !math.IsInf(n, 0) }
func validItem(i *Item) bool {
	return i != nil && i.InternalID != "" && StringLength(i.InternalID) <= 200 && i.InstanceID >= 0 && i.InstanceID <= maxSafeInteger && i.GroupID >= 0 && i.GroupID <= maxSafeInteger && i.GameID >= 0 && i.GameID <= maxSafeInteger && finite(i.X) && finite(i.Y) && finite(i.Z) && finite(i.Rotation.X) && finite(i.Rotation.Y) && finite(i.Rotation.Z) && len(i.Extra) > 0 && json.Valid(i.Extra) && i.Extra[0] == '{'
}
func Normalize(d *Document) (err error) {
	defer func() {
		if err != nil && !errors.Is(err, ErrInvalid) {
			err = fmt.Errorf("%w: %v", ErrInvalid, err)
		}
	}()
	if d == nil || strings.TrimSpace(d.RoomCode) == "" || d.Revision < 1 || d.Revision > maxSafeInteger {
		return errors.New("invalid document")
	}
	if d.CollectionTreeVersion != 0 && d.CollectionTreeVersion != 3 {
		return errors.New("unsupported collectionTreeVersion")
	}
	if d.Scheme.Items == nil || d.Scheme.GroupOrigins == nil {
		return errors.New("invalid scheme snapshot")
	}
	if d.Scheme.CollectionTree.Nodes == nil && d.Scheme.CollectionTree.Groups == nil {
		d.Scheme.CollectionTree = EmptyTree()
	}
	if strings.TrimSpace(d.Scheme.Name) == "" {
		d.Scheme.Name = "Cloud Scheme"
	}
	d.Scheme.Name = strings.TrimSpace(d.Scheme.Name)
	seen := map[string]bool{}
	maxI, maxG := int64(999), int64(0)
	for _, i := range d.Scheme.Items {
		if !validItem(i) || seen[i.InternalID] {
			return errors.New("invalid or duplicate item")
		}
		seen[i.InternalID] = true
		maxI = max(maxI, i.InstanceID)
		maxG = max(maxG, i.GroupID)
	}
	if err := ValidateTree(d.Scheme.CollectionTree, d.Scheme.Items); err != nil {
		return err
	}
	for _, p := range d.Scheme.GroupOrigins {
		if p.ID <= 0 || p.ID > maxSafeInteger || p.Value == "" {
			return errors.New("invalid group origin")
		}
	}
	d.NextInstanceID = max(d.NextInstanceID, maxI+1)
	d.NextGroupID = max(d.NextGroupID, maxG+1)
	d.CollectionTreeVersion = 3
	if d.NextInstanceID > maxSafeInteger || d.NextGroupID > maxSafeInteger {
		return errors.New("ID allocator exhausted")
	}
	return nil
}
func DecodeTree(raw []byte) (Tree, error) {
	var t Tree
	if err := json.Unmarshal(raw, &t); err != nil {
		return t, err
	}
	if !validTree(t) {
		return t, errors.New("invalid collection tree")
	}
	return t, nil
}
func decodePairs(raw []byte, names bool) ([]Pair, error) {
	var entries []Pair
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		return nil, errors.New("expected group entries")
	}
	seen := map[int64]bool{}
	for _, p := range entries {
		if p.ID <= 0 || p.ID > maxSafeInteger || seen[p.ID] || (names && !validName(p.Value)) {
			return nil, errors.New("invalid group entries")
		}
		seen[p.ID] = true
	}
	return entries, nil
}
func raw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

type Receipt struct {
	TransactionID string `json:"transactionId"`
	Revision      int64  `json:"revision"`
}

// Required tree fields have meaning distinct from their Go zero values.
func (t *Tree) UnmarshalJSON(data []byte) error {
	type plain Tree
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.Nodes == nil || value.Groups == nil {
		return errors.New("collection tree requires arrays")
	}
	var shape struct {
		Nodes  []map[string]json.RawMessage `json:"nodes"`
		Groups []map[string]json.RawMessage `json:"groups"`
	}
	if err := json.Unmarshal(data, &shape); err != nil {
		return err
	}
	for _, n := range shape.Nodes {
		for _, key := range []string{"id", "name", "parentId", "order"} {
			if v, ok := n[key]; !ok || (key == "order" && string(v) == "null") {
				return errors.New("missing collection node field")
			}
		}
		if v, ok := n["originItemId"]; ok && string(v) == "null" {
			return errors.New("invalid collection origin")
		}
	}
	for _, g := range shape.Groups {
		for _, key := range []string{"groupId", "collectionId", "order"} {
			if v, ok := g[key]; !ok || (key == "order" && string(v) == "null") {
				return errors.New("missing group metadata field")
			}
		}
		if v, ok := g["name"]; ok && string(v) == "null" {
			return errors.New("invalid group name")
		}
	}
	*t = Tree(value)
	return nil
}
func (op *Operation) UnmarshalJSON(data []byte) error {
	type plain Operation
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	switch value.Type {
	case "patch_items":
		value.Items = nil
		value.Before = nil
		value.After = nil
	case "add_items", "remove_items":
		value.Changes = nil
		value.Before = nil
		value.After = nil
	default:
		value.Changes = nil
		value.Items = nil
	}
	*op = Operation(value)
	return nil
}
