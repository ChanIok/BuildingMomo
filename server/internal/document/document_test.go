package document

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func canonical(v any) any { b, _ := json.Marshal(v); var x any; _ = json.Unmarshal(b, &x); return x }
func TestReferenceTransactions(t *testing.T) {
	f, err := os.Open("testdata/reference.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	count := 0
	for scanner.Scan() {
		count++
		var c struct {
			Before    *Document    `json:"before"`
			Log       []LogEntry   `json:"log"`
			Push      Push         `json:"push"`
			After     *Document    `json:"after"`
			Kind      string       `json:"kind"`
			Committed *Transaction `json:"committed"`
		}
		if err = json.Unmarshal(scanner.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		before := canonical(c.Before)
		idx := ImportLog(c.Before.Revision, c.Log)
		next, index, tx, err := Prepare(c.Before, idx, c.Push, c.After.UpdatedAt)
		switch c.Kind {
		case "tx_committed":
			if err != nil {
				t.Errorf("case %d tx=%s: %v", count, c.Push.Transaction.ID, err)
				continue
			}
			if !reflect.DeepEqual(canonical(next), canonical(c.After)) {
				t.Errorf("case %d tx=%s: document mismatch\nactual=%s\nexpected=%s", count, tx.ID, raw(next), raw(c.After))
			}
			if c.Committed != nil && !reflect.DeepEqual(canonical(tx.Ops), canonical(c.Committed.Ops)) {
				t.Errorf("case %d: normalized operations differ", count)
			}
			if err = ValidateIndex(index, next.Revision); err != nil {
				t.Fatal(err)
			}
		case "reset":
			if !errors.Is(err, ErrConflict) {
				t.Errorf("case %d: expected conflict, got %v", count, err)
			}
		case "error":
			if err == nil || errors.Is(err, ErrConflict) {
				t.Errorf("case %d: expected validation error, got %v", count, err)
			}
		}
		if !reflect.DeepEqual(before, canonical(c.Before)) {
			t.Errorf("case %d modified old document", count)
		}
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if count < 50 {
		t.Fatalf("incomplete reference inventory: %d cases", count)
	}
	t.Logf("%d original-server transaction cases", count)
}
func item(id string, instance, group int64) *Item {
	return &Item{InternalID: id, InstanceID: instance, GameID: 1, GroupID: group, Extra: json.RawMessage(`{"Scale":{"X":1,"Y":1,"Z":1},"unknown":9007199254740993}`)}
}
func base(t *testing.T) *Document {
	t.Helper()
	d := &Document{RoomCode: "test", Revision: 1, Scheme: Snapshot{Name: "Test", Items: []*Item{item("a", 1000, 0), item("b", 1001, 0)}, GroupOrigins: []Pair{}, CollectionTree: EmptyTree()}}
	if err := Normalize(d); err != nil {
		t.Fatal(err)
	}
	return d
}
func move(i *Item, x float64) Operation {
	after := *i
	after.X = x
	return Operation{Type: "patch_items", Changes: []Change{{ItemID: i.InternalID, Before: i, After: &after}}}
}
func TestStructuralSharingAndCompactWindow(t *testing.T) {
	d := base(t)
	original := d
	idx := NewIndex(1)
	for n := 0; n < 60; n++ {
		p := Push{Type: "push_tx", BaseRevision: d.Revision, Transaction: Transaction{ID: "tx", Ops: []Operation{move(d.Scheme.Items[0], float64(n))}}}
		next, index, _, err := Prepare(d, idx, p, int64(n))
		if err != nil {
			t.Fatal(err)
		}
		if next.Scheme.Items[1] != d.Scheme.Items[1] {
			t.Fatal("untouched item copied")
		}
		d, idx = next, index
	}
	if len(idx.Touched) != 1 || idx.Floor != 11 || original.Revision != 1 || original.Scheme.Items[0].X != 0 {
		t.Fatal("bad compact window or mutation")
	}
	if string(d.Scheme.Items[0].Extra) != string(original.Scheme.Items[0].Extra) {
		t.Fatal("opaque extra lost")
	}
}
func TestLaggingIndexEquivalentToReferenceLog(t *testing.T) {
	d := base(t)
	idx := NewIndex(1)
	var log []LogEntry
	for n := 0; n < 70; n++ {
		target := n % 2
		p := Push{Type: "push_tx", BaseRevision: d.Revision, Transaction: Transaction{ID: "tx", Ops: []Operation{move(d.Scheme.Items[target], float64(n))}}}
		next, index, _, err := Prepare(d, idx, p, int64(n))
		if err != nil {
			t.Fatal(err)
		}
		d, idx = next, index
		log = append(log, LogEntry{Revision: d.Revision, TouchedItemIDs: []string{d.Scheme.Items[target].InternalID}})
		if len(log) > 50 {
			log = log[1:]
		}
		if !reflect.DeepEqual(idx, ImportLog(d.Revision, log)) {
			t.Fatal("compact index changed conflict semantics")
		}
	}
}
func TestStaleWholeOriginMapCannotEraseDisjointRemoteOrigin(t *testing.T) {
	d := base(t)
	d.Scheme.Items[0].GroupID, d.Scheme.Items[1].GroupID = 1, 2
	d.Scheme.GroupOrigins = []Pair{{1, "a"}, {2, "b"}}
	if err := Normalize(d); err != nil {
		t.Fatal(err)
	}
	idx := NewIndex(d.Revision)
	first := Push{Type: "push_tx", BaseRevision: 1, Transaction: Transaction{ID: "first", Ops: []Operation{{Type: "set_group_origins", Before: raw(d.Scheme.GroupOrigins), After: raw([]Pair{{2, "b"}})}}}}
	next, index, _, err := Prepare(d, idx, first, 1)
	if err != nil {
		t.Fatal(err)
	}
	// This client only changed group 2, but its full after-map still contains
	// group 1's removed origin. The two item footprints do not overlap.
	second := Push{Type: "push_tx", BaseRevision: 1, Transaction: Transaction{ID: "second", Ops: []Operation{{Type: "set_group_origins", Before: raw(d.Scheme.GroupOrigins), After: raw([]Pair{{1, "a"}})}}}}
	if _, _, _, err = Prepare(next, index, second, 2); !errors.Is(err, ErrConflict) {
		t.Fatal("stale replacement could resurrect a remote origin", err)
	}
	if len(next.Scheme.GroupOrigins) != 1 || next.Scheme.GroupOrigins[0].ID != 2 {
		t.Fatal("durable candidate mutated")
	}
	// Pure ordering differences are not a conflict.
	if !sameOrigins([]Pair{{1, "a"}, {2, "b"}}, []Pair{{2, "b"}, {1, "a"}}) {
		t.Fatal("origin order changed semantics")
	}
}
