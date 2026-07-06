package db

import (
	"regexp"
	"strings"
)

var goLine = regexp.MustCompile(`(?i)^\s*GO(?:\s+\d+)?\s*(?:--.*)?$`)

// SplitBatches splits a script on line-anchored GO separators, the way SSMS
// does. GO inside string literals or block comments is not a separator.
// GO <count> is treated as a single execution.
func SplitBatches(script string) []string {
	var batches []string
	var cur strings.Builder

	inString := false   // inside '...' (doubled '' stays inside)
	inBracket := false  // inside [...] identifier
	blockDepth := 0     // /* */ nesting (T-SQL block comments nest)

	lines := strings.Split(script, "\n")
	for _, line := range lines {
		if !inString && !inBracket && blockDepth == 0 && goLine.MatchString(strings.TrimSuffix(line, "\r")) {
			if s := strings.TrimSpace(cur.String()); s != "" {
				batches = append(batches, cur.String())
			}
			cur.Reset()
			continue
		}
		cur.WriteString(line)
		cur.WriteString("\n")

		// advance the lexer state across this line
		i := 0
		for i < len(line) {
			c := line[i]
			switch {
			case inString:
				if c == '\'' {
					if i+1 < len(line) && line[i+1] == '\'' {
						i++ // escaped quote
					} else {
						inString = false
					}
				}
			case inBracket:
				if c == ']' {
					inBracket = false
				}
			case blockDepth > 0:
				if c == '*' && i+1 < len(line) && line[i+1] == '/' {
					blockDepth--
					i++
				} else if c == '/' && i+1 < len(line) && line[i+1] == '*' {
					blockDepth++
					i++
				}
			default:
				switch c {
				case '\'':
					inString = true
				case '[':
					inBracket = true
				case '-':
					if i+1 < len(line) && line[i+1] == '-' {
						i = len(line) // rest of line is a comment
					}
				case '/':
					if i+1 < len(line) && line[i+1] == '*' {
						blockDepth++
						i++
					}
				}
			}
			i++
		}
		// line comments end at newline; a multiline string keeps inString=true
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		batches = append(batches, cur.String())
	}
	return batches
}
