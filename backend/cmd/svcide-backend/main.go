package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"svcide/internal/server"
)

func main() {
	log.SetOutput(os.Stderr)

	token := os.Getenv("SVCIDE_TOKEN")
	if token == "" {
		log.Fatal("SVCIDE_TOKEN is required")
	}

	if pidStr := os.Getenv("SVCIDE_PARENT_PID"); pidStr != "" {
		if pid, err := strconv.Atoi(pidStr); err == nil {
			server.WatchParent(pid)
		}
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	shutdownCh := make(chan struct{})
	handler, err := server.New(token, shutdownCh)
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	srv := &http.Server{Handler: handler}

	go func() {
		<-shutdownCh
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	ready, _ := json.Marshal(map[string]any{"event": "ready", "port": port})
	fmt.Println(string(ready))

	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}
