package document

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
)

func (op Operation) MarshalJSON() ([]byte, error) {
	switch op.Type {
	case "patch_items":
		return json.Marshal(struct {
			Type    string   `json:"type"`
			Changes []Change `json:"changes"`
		}{op.Type, op.Changes})
	case "add_items", "remove_items":
		return json.Marshal(struct {
			Type  string  `json:"type"`
			Items []*Item `json:"items"`
		}{op.Type, op.Items})
	default:
		return json.Marshal(struct {
			Type   string          `json:"type"`
			Before json.RawMessage `json:"before"`
			After  json.RawMessage `json:"after"`
		}{op.Type, op.Before, op.After})
	}
}

func copyTransaction(tx Transaction) Transaction {
	tx.Ops = slices.Clone(tx.Ops)
	for k, op := range tx.Ops {
		op.Changes = slices.Clone(op.Changes)
		op.Items = slices.Clone(op.Items)
		for j, c := range op.Changes {
			v := *c.After
			op.Changes[j].After = &v
		}
		for j, i := range op.Items {
			v := *i
			op.Items[j] = &v
		}
		tx.Ops[k] = op
	}
	return tx
}

func normalizeIDs(d *Document, tx *Transaction) {
	hit := map[string]bool{}
	for _, op := range tx.Ops {
		for _, c := range op.Changes {
			hit[c.ItemID] = true
		}
		for _, i := range op.Items {
			hit[i.InternalID] = true
		}
	}
	externalI, externalG, reservedI := map[int64]bool{}, map[int64]bool{}, map[int64]bool{}
	for _, i := range d.Scheme.Items {
		if !hit[i.InternalID] {
			externalI[i.InstanceID] = true
			if i.GroupID > 0 {
				externalG[i.GroupID] = true
			}
		}
	}
	retained := maps.Clone(externalG)
	for _, op := range tx.Ops {
		for _, c := range op.Changes {
			if c.Before.GroupID > 0 && c.Before.GroupID == c.After.GroupID {
				retained[c.Before.GroupID] = true
			}
		}
	}
	initialI, initialG := d.NextInstanceID, d.NextGroupID
	nextI, nextG := initialI, initialG
	remap, reservedG := map[int64]int64{}, map[int64]bool{}
	allocateI := func() int64 {
		for externalI[nextI] || reservedI[nextI] {
			nextI++
		}
		id := nextI
		reservedI[id] = true
		nextI++
		return id
	}
	allocateG := func() int64 {
		for externalG[nextG] || reservedG[nextG] {
			nextG++
		}
		id := nextG
		reservedG[id] = true
		nextG++
		return id
	}
	normalizeG := func(id int64, introduced bool) int64 {
		if id <= 0 || !introduced {
			return id
		}
		if to, ok := remap[id]; ok {
			return to
		}
		if id < initialG || externalG[id] {
			remap[id] = allocateG()
			return remap[id]
		}
		return id
	}
	for oi := range tx.Ops {
		op := &tx.Ops[oi]
		for _, c := range op.Changes {
			i := c.After
			if i.InstanceID != c.Before.InstanceID && (i.InstanceID < initialI || externalI[i.InstanceID] || reservedI[i.InstanceID]) {
				i.InstanceID = allocateI()
			} else {
				reservedI[i.InstanceID] = true
			}
			i.GroupID = normalizeG(i.GroupID, i.GroupID != c.Before.GroupID && !retained[i.GroupID])
		}
		if op.Type == "add_items" {
			for _, i := range op.Items {
				if i.InstanceID < initialI || externalI[i.InstanceID] || reservedI[i.InstanceID] {
					i.InstanceID = allocateI()
				} else {
					reservedI[i.InstanceID] = true
				}
				i.GroupID = normalizeG(i.GroupID, true)
			}
		}
	}
	if len(remap) > 0 {
		for oi := range tx.Ops {
			op := &tx.Ops[oi]
			switch op.Type {
			case "set_collection_tree":
				before, _ := DecodeTree(op.Before)
				after, _ := DecodeTree(op.After)
				previous := map[int64]Group{}
				for _, g := range before.Groups {
					previous[g.ID] = g
				}
				for k, g := range after.Groups {
					old, ok := previous[g.ID]
					if !ok || !same(g.CollectionID, old.CollectionID) || g.Order != old.Order {
						if to, ok := remap[g.ID]; ok {
							after.Groups[k].ID = to
						}
					}
				}
				op.After = raw(after)
			case "set_group_origins", "set_group_names":
				pairs, _ := decodePairs(op.After, op.Type == "set_group_names")
				for k, p := range pairs {
					if to, ok := remap[p.ID]; ok {
						pairs[k].ID = to
					}
				}
				op.After = raw(pairs)
			}
		}
	}
	d.NextInstanceID, d.NextGroupID = nextI, nextG
}

func apply(d *Document, tx *Transaction) error {
	previousItems, previousTree := d.Scheme.Items, d.Scheme.CollectionTree
	items, copied := previousItems, false
	var lookup map[string]int
	var explicit *Tree
	var names []Operation
	origins := d.Scheme.GroupOrigins
	ensure := func() {
		if !copied {
			items = slices.Clone(items)
			copied = true
		}
		if lookup == nil {
			lookup = make(map[string]int, len(items))
			for k, i := range items {
				lookup[i.InternalID] = k
			}
		}
	}
	for _, op := range tx.Ops {
		switch op.Type {
		case "patch_items":
			ensure()
			for _, c := range op.Changes {
				if k, ok := lookup[c.ItemID]; ok {
					items[k] = c.After
				}
			}
		case "add_items":
			ensure()
			for _, i := range op.Items {
				if k, ok := lookup[i.InternalID]; ok {
					items[k] = i
				} else {
					lookup[i.InternalID] = len(items)
					items = append(items, i)
				}
			}
		case "remove_items":
			removed := map[string]bool{}
			for _, i := range op.Items {
				removed[i.InternalID] = true
			}
			next := make([]*Item, 0, len(items))
			for _, i := range items {
				if !removed[i.InternalID] {
					next = append(next, i)
				}
			}
			items, lookup, copied = next, nil, true
		case "set_collection_tree":
			v, _ := DecodeTree(op.After)
			explicit = &v
		case "set_group_names":
			names = append(names, op)
		case "set_group_origins":
			before, _ := decodePairs(op.Before, false)
			// This opcode replaces the whole map, unlike group-name deltas. A
			// disjoint item footprint alone cannot justify replacing newer origins.
			if !sameOrigins(origins, before) {
				return ErrConflict
			}
			origins, _ = decodePairs(op.After, false)
		}
	}
	tree := reconcileGroups(previousTree, previousItems, items)
	if explicit != nil {
		tree = applyStructure(tree, *explicit)
	} else {
		tree, _ = reconcileOrigins(tree, items)
	}
	a, b := Structure(previousTree), Structure(tree)
	if explicit == nil && !treeEqual(a, b) {
		tx.Ops = append(tx.Ops, Operation{Type: "set_collection_tree", Before: raw(a), After: raw(b)})
	}
	for _, op := range names {
		before, _ := decodePairs(op.Before, true)
		after, _ := decodePairs(op.After, true)
		tree = patchNames(tree, before, after)
	}
	d.Scheme.Items, d.Scheme.CollectionTree, d.Scheme.GroupOrigins = items, tree, origins
	if err := ValidateTree(tree, items); err != nil {
		return err
	}
	for _, i := range items {
		d.NextInstanceID = max(d.NextInstanceID, i.InstanceID+1)
		d.NextGroupID = max(d.NextGroupID, i.GroupID+1)
	}
	if d.NextInstanceID > maxSafeInteger || d.NextGroupID > maxSafeInteger {
		return errors.New("ID allocator exhausted")
	}
	return nil
}

func sameOrigins(a, b []Pair) bool {
	if len(a) != len(b) {
		return false
	}
	values := make(map[int64]string, len(a))
	for _, p := range a {
		values[p.ID] = p.Value
	}
	for _, p := range b {
		if value, ok := values[p.ID]; !ok || value != p.Value {
			return false
		}
	}
	return true
}

func NewIndex(revision int64) Index { return Index{Floor: revision, Touched: map[string]int64{}} }

// ImportLog uses only the contiguous suffix; missing records cannot make an
// otherwise conflicting transaction mergeable.
func ImportLog(revision int64, entries []LogEntry) Index {
	byRev := map[int64]LogEntry{}
	for _, e := range entries {
		if e.Revision > 0 && e.Revision <= revision {
			byRev[e.Revision] = e
		}
	}
	idx := NewIndex(revision)
	for r := revision; r > max(int64(1), revision-Window); r-- {
		e, ok := byRev[r]
		if !ok {
			break
		}
		idx.Floor = r - 1
		if e.CollectionTreeChanged {
			idx.LastTree = max(idx.LastTree, r)
		}
		for _, id := range e.TouchedItemIDs {
			idx.Touched[id] = max(idx.Touched[id], r)
		}
	}
	return idx
}

func ValidateIndex(idx Index, revision int64) error {
	if idx.Floor < 1 || idx.Floor > revision || idx.Touched == nil || idx.LastTree > revision {
		return errors.New("invalid conflict index")
	}
	for id, r := range idx.Touched {
		if id == "" || r <= idx.Floor || r > revision {
			return errors.New("invalid conflict entry")
		}
	}
	return nil
}

func Prepare(d *Document, idx Index, p Push, now int64) (nextDocument *Document, nextIndex Index, committed Transaction, err error) {
	defer func() {
		if err != nil && !errors.Is(err, ErrConflict) && !errors.Is(err, ErrInvalid) {
			err = fmt.Errorf("%w: %v", ErrInvalid, err)
		}
	}()
	if p.Type != "push_tx" {
		return nil, idx, Transaction{}, errors.New("expected push_tx")
	}
	if err := validateTransaction(p.Transaction); err != nil {
		return nil, idx, Transaction{}, err
	}
	for _, op := range p.Transaction.Ops {
		if op.Type == "set_collection_tree" {
			before, _ := DecodeTree(op.Before)
			if !treeEqual(Structure(before), Structure(d.Scheme.CollectionTree)) {
				return nil, idx, Transaction{}, ErrConflict
			}
		}
	}
	ids, err := footprint(d, p.Transaction)
	if err != nil {
		return nil, idx, Transaction{}, err
	}
	if p.BaseRevision < idx.Floor || p.BaseRevision > d.Revision {
		return nil, idx, Transaction{}, ErrConflict
	}
	if p.BaseRevision < d.Revision {
		for _, id := range ids {
			if idx.Touched[id] > p.BaseRevision {
				return nil, idx, Transaction{}, ErrConflict
			}
		}
		for _, op := range p.Transaction.Ops {
			if op.Type == "set_collection_tree" && idx.LastTree > p.BaseRevision {
				return nil, idx, Transaction{}, ErrConflict
			}
		}
	}
	tx, candidate := copyTransaction(p.Transaction), *d
	normalizeIDs(&candidate, &tx)
	if err := apply(&candidate, &tx); err != nil {
		return nil, idx, Transaction{}, err
	}
	candidate.Revision++
	candidate.UpdatedAt = now
	if candidate.Revision > maxSafeInteger {
		return nil, idx, Transaction{}, errors.New("revision exhausted")
	}
	next := Index{Floor: max(idx.Floor, candidate.Revision-Window), LastTree: idx.LastTree, Touched: maps.Clone(idx.Touched)}
	for _, id := range ids {
		next.Touched[id] = candidate.Revision
	}
	for _, op := range tx.Ops {
		if op.Type == "set_collection_tree" {
			next.LastTree = candidate.Revision
		}
	}
	for id, r := range next.Touched {
		if r <= next.Floor {
			delete(next.Touched, id)
		}
	}
	return &candidate, next, tx, nil
}
