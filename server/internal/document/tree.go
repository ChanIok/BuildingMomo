package document

import (
	"errors"
	"maps"
	"slices"
	"strings"
)

func same(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func validTree(t Tree) bool {
	if t.Nodes == nil || t.Groups == nil {
		return false
	}
	parents := map[string]*string{}
	for _, n := range t.Nodes {
		if n.ID == "" || n.ID == "@unclassified" || StringLength(n.ID) > 100 || !validName(n.Name) || !finite(n.Order) || (n.OriginItemID != nil && (*n.OriginItemID == "" || StringLength(*n.OriginItemID) > 100)) {
			return false
		}
		if _, ok := parents[n.ID]; ok {
			return false
		}
		parents[n.ID] = n.ParentID
	}
	checked := map[string]bool{}
	for id := range parents {
		path := map[string]bool{}
		cursor := &id
		for cursor != nil && !checked[*cursor] {
			p, ok := parents[*cursor]
			if !ok || path[*cursor] {
				return false
			}
			path[*cursor] = true
			cursor = p
		}
		for k := range path {
			checked[k] = true
		}
	}
	groups := map[int64]bool{}
	for _, g := range t.Groups {
		if g.ID <= 0 || g.ID > maxSafeInteger || groups[g.ID] || !finite(g.Order) || (g.Name != nil && !validName(*g.Name)) {
			return false
		}
		if g.CollectionID != nil {
			if _, ok := parents[*g.CollectionID]; !ok {
				return false
			}
		}
		groups[g.ID] = true
	}
	return true
}
func treeEqual(a, b Tree) bool {
	if len(a.Nodes) != len(b.Nodes) || len(a.Groups) != len(b.Groups) {
		return false
	}
	nodes := map[string]Node{}
	groups := map[int64]Group{}
	for _, n := range b.Nodes {
		nodes[n.ID] = n
	}
	for _, g := range b.Groups {
		groups[g.ID] = g
	}
	for _, n := range a.Nodes {
		v, ok := nodes[n.ID]
		if !ok || n.Name != v.Name || n.Order != v.Order || !same(n.ParentID, v.ParentID) || !same(n.OriginItemID, v.OriginItemID) {
			return false
		}
	}
	for _, g := range a.Groups {
		v, ok := groups[g.ID]
		if !ok || g.Order != v.Order || !same(g.Name, v.Name) || !same(g.CollectionID, v.CollectionID) {
			return false
		}
	}
	return true
}
func Structure(t Tree) Tree {
	out := Tree{Nodes: t.Nodes, Groups: []Group{}}
	for _, g := range t.Groups {
		if g.CollectionID != nil || g.Order != float64(g.ID) {
			g.Name = nil
			out.Groups = append(out.Groups, g)
		}
	}
	return out
}
func Names(t Tree) []Pair {
	out := []Pair{}
	for _, g := range t.Groups {
		if g.Name != nil {
			out = append(out, Pair{g.ID, *g.Name})
		}
	}
	return out
}
func patchNames(t Tree, before, after []Pair) Tree {
	changes := map[int64]*string{}
	order := []int64{}
	for _, p := range before {
		if _, ok := changes[p.ID]; !ok {
			order = append(order, p.ID)
		}
		changes[p.ID] = nil
	}
	for _, p := range after {
		if _, ok := changes[p.ID]; !ok {
			order = append(order, p.ID)
		}
		v := p.Value
		changes[p.ID] = &v
	}
	groups := []Group{}
	for _, g := range t.Groups {
		v, ok := changes[g.ID]
		if !ok {
			groups = append(groups, g)
			continue
		}
		delete(changes, g.ID)
		g.Name = v
		if v != nil || g.CollectionID != nil || g.Order != float64(g.ID) {
			groups = append(groups, g)
		}
	}
	for _, id := range order {
		if v, ok := changes[id]; ok && v != nil {
			groups = append(groups, Group{ID: id, Name: v, Order: float64(id)})
			delete(changes, id)
		}
	}
	return Tree{Nodes: t.Nodes, Groups: groups}
}
func applyStructure(t, s Tree) Tree { return patchNames(Structure(s), nil, Names(t)) }
func reconcileOrigins(t Tree, items []*Item) (Tree, bool) {
	parents := map[string]*string{}
	assignments := map[int64]*string{}
	byID := map[string]*Item{}
	needed := false
	for _, n := range t.Nodes {
		parents[n.ID] = n.ParentID
		if n.OriginItemID != nil {
			needed = true
		}
	}
	if !needed {
		return t, false
	}
	for _, g := range t.Groups {
		assignments[g.ID] = g.CollectionID
	}
	for _, i := range items {
		byID[i.InternalID] = i
	}
	nodes := slices.Clone(t.Nodes)
	changed := false
	for k, n := range nodes {
		if n.OriginItemID == nil {
			continue
		}
		valid := false
		if item := byID[*n.OriginItemID]; item != nil {
			cursor := assignments[item.GroupID]
			for cursor != nil {
				if *cursor == n.ID {
					valid = true
					break
				}
				cursor = parents[*cursor]
			}
		}
		if !valid {
			nodes[k].OriginItemID = nil
			changed = true
		}
	}
	if changed {
		t.Nodes = nodes
	}
	return t, changed
}
func ValidateTree(t Tree, items []*Item) error {
	if !validTree(t) {
		return errors.New("invalid collection tree")
	}
	live := map[int64]bool{}
	for _, i := range items {
		live[i.GroupID] = true
	}
	for _, g := range t.Groups {
		if !live[g.ID] {
			return errors.New("invalid collection group reference")
		}
	}
	if _, changed := reconcileOrigins(t, items); changed {
		return errors.New("invalid collection origin reference")
	}
	return nil
}
func reconcileGroups(t Tree, previous, next []*Item) Tree {
	if len(t.Groups) == 0 {
		return t
	}
	live := map[int64]bool{}
	nextByID := map[string]int64{}
	dest := map[int64]map[int64]bool{}
	sources := map[int64]map[int64]bool{}
	for _, i := range next {
		live[i.GroupID] = true
		nextByID[i.InternalID] = i.GroupID
	}
	for _, i := range previous {
		to, ok := nextByID[i.InternalID]
		if i.GroupID <= 0 || !ok {
			continue
		}
		if dest[i.GroupID] == nil {
			dest[i.GroupID] = map[int64]bool{}
		}
		dest[i.GroupID][to] = true
		if sources[to] == nil {
			sources[to] = map[int64]bool{}
		}
		sources[to][i.GroupID] = true
	}
	remap := map[int64]int64{}
	for from, targets := range dest {
		if len(targets) != 1 {
			continue
		}
		for to := range targets {
			if to > 0 && to != from && dest[to] == nil && len(sources[to]) == 1 {
				remap[from] = to
			}
		}
	}
	groups := []Group{}
	seen := map[int64]bool{}
	for _, g := range t.Groups {
		if _, changed := remap[g.ID]; !changed && live[g.ID] {
			groups = append(groups, g)
			seen[g.ID] = true
		}
	}
	for _, g := range t.Groups {
		if to, ok := remap[g.ID]; ok {
			g.ID = to
		}
		if live[g.ID] && !seen[g.ID] {
			groups = append(groups, g)
			seen[g.ID] = true
		}
	}
	return Tree{Nodes: t.Nodes, Groups: groups}
}
func footprint(d *Document, tx Transaction) ([]string, error) {
	ids := map[string]bool{}
	local := map[int64]map[string]bool{}
	for _, op := range tx.Ops {
		for _, c := range op.Changes {
			ids[c.ItemID] = true
			if c.After.GroupID > 0 {
				if local[c.After.GroupID] == nil {
					local[c.After.GroupID] = map[string]bool{}
				}
				local[c.After.GroupID][c.ItemID] = true
			}
		}
		for _, i := range op.Items {
			ids[i.InternalID] = true
			if op.Type == "add_items" && i.GroupID > 0 {
				if local[i.GroupID] == nil {
					local[i.GroupID] = map[string]bool{}
				}
				local[i.GroupID][i.InternalID] = true
			}
		}
	}
	for _, op := range tx.Ops {
		if op.Type != "set_group_origins" && op.Type != "set_group_names" {
			continue
		}
		before, _ := decodePairs(op.Before, op.Type == "set_group_names")
		after, _ := decodePairs(op.After, op.Type == "set_group_names")
		a, b := map[int64]string{}, map[int64]string{}
		all := map[int64]bool{}
		for _, p := range before {
			a[p.ID] = p.Value
			all[p.ID] = true
		}
		for _, p := range after {
			b[p.ID] = p.Value
			all[p.ID] = true
		}
		for g := range all {
			av, ak := a[g]
			bv, bk := b[g]
			if ak == bk && av == bv {
				continue
			}
			found := false
			for _, i := range d.Scheme.Items {
				if i.GroupID == g {
					ids[i.InternalID] = true
					found = true
				}
			}
			for id := range local[g] {
				ids[id] = true
				found = true
			}
			if !found {
				return nil, ErrConflict
			}
		}
	}
	return slices.Sorted(maps.Keys(ids)), nil
}
func validPairs(rawData []byte, names bool) error { _, err := decodePairs(rawData, names); return err }
func validateTransaction(tx Transaction) error {
	if strings.TrimSpace(tx.ID) == "" || StringLength(tx.ID) > 200 || tx.Ops == nil {
		return errors.New("invalid transaction")
	}
	treeCount := 0
	for _, op := range tx.Ops {
		switch op.Type {
		case "patch_items":
			if op.Changes == nil {
				return errors.New("missing changes")
			}
			for _, c := range op.Changes {
				if c.ItemID == "" || !validItem(c.Before) || !validItem(c.After) || c.ItemID != c.Before.InternalID || c.ItemID != c.After.InternalID {
					return errors.New("invalid item change")
				}
			}
		case "add_items", "remove_items":
			if op.Items == nil {
				return errors.New("missing items")
			}
			for _, i := range op.Items {
				if !validItem(i) {
					return errors.New("invalid item")
				}
			}
		case "set_group_names", "set_group_origins":
			if err := validPairs(op.Before, op.Type == "set_group_names"); err != nil {
				return err
			}
			if err := validPairs(op.After, op.Type == "set_group_names"); err != nil {
				return err
			}
		case "set_collection_tree":
			treeCount++
			for _, b := range [][]byte{op.Before, op.After} {
				t, err := DecodeTree(b)
				if err != nil {
					return err
				}
				for _, g := range t.Groups {
					if g.Name != nil {
						return errors.New("collection transaction contains names")
					}
				}
			}
		default:
			return errors.New("unknown transaction operation")
		}
	}
	if treeCount > 1 {
		return errors.New("multiple collection tree operations")
	}
	return nil
}
