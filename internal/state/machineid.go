package state

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

// deviceIDSalt keeps the derived device id from being a reversible lookup of
// the raw OS machine id. It is intentionally fixed so the same machine always
// derives the same device id.
const deviceIDSalt = "token-plane-device-v1"

var ioPlatformUUIDPattern = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`)

func readDarwinMachineID() string {
	output, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return ""
	}
	match := ioPlatformUUIDPattern.FindSubmatch(output)
	if match == nil {
		return ""
	}
	return strings.TrimSpace(string(match[1]))
}

func readLinuxMachineID() string {
	for _, path := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		id := strings.TrimSpace(string(data))
		if id != "" {
			return id
		}
	}
	return ""
}

func readMachineID() string {
	switch runtime.GOOS {
	case "darwin":
		return readDarwinMachineID()
	case "linux":
		return readLinuxMachineID()
	default:
		return ""
	}
}

// machineDerivedDeviceID returns a stable UUID-shaped device id derived from
// the OS machine id, so reinstalling (or wiping the state directory) on the
// same machine reattaches to the same remote device row. Returns "" when no
// machine id is available; callers fall back to a random UUID.
func machineDerivedDeviceID() string {
	machineID := readMachineID()
	if machineID == "" {
		return ""
	}

	sum := sha256.Sum256([]byte(deviceIDSalt + ":" + machineID))
	bytes := sum[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80

	encoded := make([]byte, 32)
	hex.Encode(encoded, bytes)
	return string(encoded[0:8]) + "-" +
		string(encoded[8:12]) + "-" +
		string(encoded[12:16]) + "-" +
		string(encoded[16:20]) + "-" +
		string(encoded[20:32])
}
