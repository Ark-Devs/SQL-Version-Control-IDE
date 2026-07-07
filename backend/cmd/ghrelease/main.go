// ghrelease publishes a GitHub release with assets, authenticating with the
// token the IDE stored via "Sign in with GitHub" (or GH_TOKEN if set).
//
//	go run ./cmd/ghrelease -repo Owner/Name -tag v0.2.0 -notes notes.md file1.exe file2.yml
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

func main() {
	repo := flag.String("repo", "", "owner/name")
	tag := flag.String("tag", "", "release tag, e.g. v0.2.0")
	title := flag.String("title", "", "release title (defaults to tag)")
	notesFile := flag.String("notes", "", "markdown file with release notes")
	flag.Parse()

	if *repo == "" || *tag == "" {
		log.Fatal("-repo and -tag are required")
	}
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		var err error
		token, err = keyring.Get("SqlVcIde-Git", "github.com")
		if err != nil || token == "" {
			log.Fatal("no GitHub token: sign in with GitHub inside the IDE first, or set GH_TOKEN")
		}
	}

	notes := ""
	if *notesFile != "" {
		data, err := os.ReadFile(*notesFile)
		if err != nil {
			log.Fatalf("read notes: %v", err)
		}
		notes = string(data)
	}
	name := *title
	if name == "" {
		name = *tag
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	api := func(method, apiURL string, body io.Reader, contentType string) map[string]any {
		req, err := http.NewRequest(method, apiURL, body)
		if err != nil {
			log.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := client.Do(req)
		if err != nil {
			log.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode >= 300 {
			log.Fatalf("%s %s → %d: %s", method, apiURL, res.StatusCode, string(data))
		}
		var out map[string]any
		_ = json.Unmarshal(data, &out)
		return out
	}

	// create the release (or reuse an existing one for the tag)
	payload, _ := json.Marshal(map[string]any{
		"tag_name": *tag,
		"name":     name,
		"body":     notes,
	})
	base := "https://api.github.com/repos/" + *repo
	var release map[string]any
	req, _ := http.NewRequest("GET", base+"/releases/tags/"+url.PathEscape(*tag), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if res, err := client.Do(req); err == nil && res.StatusCode == 200 {
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		_ = json.Unmarshal(data, &release)
		fmt.Printf("reusing existing release %s\n", *tag)
	} else {
		if res != nil {
			res.Body.Close()
		}
		release = api("POST", base+"/releases", bytes.NewReader(payload), "application/json")
		fmt.Printf("created release %s\n", *tag)
	}

	uploadURL, _ := release["upload_url"].(string)
	uploadURL = strings.Split(uploadURL, "{")[0]
	if uploadURL == "" {
		log.Fatal("no upload_url in release response")
	}

	for _, path := range flag.Args() {
		f, err := os.Open(path)
		if err != nil {
			log.Fatalf("open %s: %v", path, err)
		}
		st, _ := f.Stat()
		assetName := filepath.Base(path)
		ct := mime.TypeByExtension(filepath.Ext(path))
		if ct == "" {
			ct = "application/octet-stream"
		}
		req, err := http.NewRequest("POST", uploadURL+"?name="+url.QueryEscape(assetName), f)
		if err != nil {
			log.Fatal(err)
		}
		req.ContentLength = st.Size()
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", ct)
		res, err := client.Do(req)
		if err != nil {
			log.Fatalf("upload %s: %v", assetName, err)
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		f.Close()
		if res.StatusCode >= 300 {
			log.Fatalf("upload %s → %d: %s", assetName, res.StatusCode, string(data))
		}
		fmt.Printf("uploaded %s (%.1f MB)\n", assetName, float64(st.Size())/1024/1024)
	}
	fmt.Println("release URL:", release["html_url"])
}
