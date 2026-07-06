package conn

import (
	"net/url"
	"strings"
)

// BuildDSN builds a go-mssqldb URL DSN for a profile. If database is empty the
// profile's default database is used. For Windows auth the userinfo is omitted,
// which makes the driver fall back to SSPI (the running user's context).
func BuildDSN(p Profile, password, database string) string {
	host := p.Server
	instance := ""
	// host\instance → path component; host,port → host:port
	if i := strings.IndexByte(host, '\\'); i >= 0 {
		instance = host[i+1:]
		host = host[:i]
	}
	if i := strings.IndexByte(host, ','); i >= 0 {
		host = host[:i] + ":" + strings.TrimSpace(host[i+1:])
	}

	q := url.Values{}
	db := database
	if db == "" {
		db = p.Database
	}
	if db != "" {
		q.Set("database", db)
	}
	q.Set("app name", "SqlVcIde")
	q.Set("encrypt", boolStr(p.Encrypt))
	q.Set("trustservercertificate", boolStr(p.TrustServerCertificate))
	q.Set("dial timeout", "10")
	if p.Protocol == "np" || p.Protocol == "lpc" {
		q.Set("protocol", p.Protocol)
	}

	u := &url.URL{
		Scheme:   "sqlserver",
		Host:     host,
		Path:     instance,
		RawQuery: q.Encode(),
	}
	if p.AuthMode == "sql" {
		u.User = url.UserPassword(p.Username, password)
	}
	return u.String()
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
