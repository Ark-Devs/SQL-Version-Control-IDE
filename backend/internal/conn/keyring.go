package conn

import (
	"github.com/zalando/go-keyring"
)

const keyringService = "SqlVcIde"

// SetPassword stores a profile's password in the OS credential store.
func SetPassword(profileID, password string) error {
	return keyring.Set(keyringService, profileID, password)
}

// GetPassword fetches a profile's password. Returns "" if none stored.
func GetPassword(profileID string) (string, error) {
	pw, err := keyring.Get(keyringService, profileID)
	if err == keyring.ErrNotFound {
		return "", nil
	}
	return pw, err
}

// DeletePassword removes a stored password (ignores absence).
func DeletePassword(profileID string) error {
	err := keyring.Delete(keyringService, profileID)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}
