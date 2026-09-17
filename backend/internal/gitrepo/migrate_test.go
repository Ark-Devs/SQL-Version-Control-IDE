package gitrepo

import (
	"encoding/json"
	"testing"
)

// Upgrading a pre-multi-source repo must not rewrite its object entries. The
// objects map is the large part of a real manifest (thousands of entries), so
// gaining a redundant per-object alias would turn a schema bump into a huge,
// unreviewable diff. Only the small header may change.
func TestLegacyUpgradeLeavesObjectsUnchanged(t *testing.T) {
	legacy := []byte(`{
  "sourceServer": "srv",
  "sourceConnId": "abc",
  "databases": ["Hospital", "Pharmacy"],
  "objects": {
    "SQL/Hospital/dbo/StoredProcedures/usp_Foo.sql": {"database":"Hospital","schema":"dbo","name":"usp_Foo","type":"proc"},
    "SQL/Pharmacy/dbo/Tables/Drug.sql": {"database":"Pharmacy","schema":"dbo","name":"Drug","type":"table"}
  }
}`)
	man, err := ParseManifest(legacy)
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(man)
	if err != nil {
		t.Fatal(err)
	}

	var round struct {
		Objects map[string]map[string]any `json:"objects"`
		Sources []Source                  `json:"sources"`
	}
	if err := json.Unmarshal(out, &round); err != nil {
		t.Fatal(err)
	}

	var legacyObjects struct {
		Objects map[string]map[string]any `json:"objects"`
	}
	if err := json.Unmarshal(legacy, &legacyObjects); err != nil {
		t.Fatal(err)
	}

	for path, before := range legacyObjects.Objects {
		after, ok := round.Objects[path]
		if !ok {
			t.Errorf("object path %q disappeared on upgrade", path)
			continue
		}
		if len(after) != len(before) {
			t.Errorf("object %q gained/lost fields: %v → %v", path, before, after)
		}
		for k, v := range before {
			if after[k] != v {
				t.Errorf("object %q field %q changed: %v → %v", path, k, v, after[k])
			}
		}
	}

	// the local connection id must never reach the shared manifest
	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["sourceConnId"]; ok {
		t.Error("sourceConnId written into the shared manifest")
	}
	if len(round.Sources) != 2 {
		t.Errorf("sources = %v, want 2", round.Sources)
	}
}
