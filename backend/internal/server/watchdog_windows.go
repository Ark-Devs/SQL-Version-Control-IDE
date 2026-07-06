//go:build windows

package server

import (
	"log"
	"os"

	"golang.org/x/sys/windows"
)

// WatchParent exits the process when the parent (Electron main) dies,
// so no orphaned backend keeps running.
func WatchParent(pid int) {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		log.Printf("watchdog: cannot open parent pid %d: %v", pid, err)
		return
	}
	go func() {
		_, _ = windows.WaitForSingleObject(h, windows.INFINITE)
		log.Println("watchdog: parent exited, shutting down")
		os.Exit(0)
	}()
}
