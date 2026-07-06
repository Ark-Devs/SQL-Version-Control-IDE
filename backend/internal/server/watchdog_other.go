//go:build !windows

package server

// WatchParent is a no-op on non-Windows platforms (dev convenience only;
// the product targets Windows).
func WatchParent(pid int) {}
