"""Read GenFarmer box status on macOS; no slot, power, or firmware writes."""
import binascii
import fcntl
import json
import os
import plistlib
import select
import struct
import subprocess
import sys
import termios
import time
import tty
from datetime import datetime, timezone


def request(command):
    if command not in (2, 3, 7):
        raise ValueError("Only connect, disconnect, and read-status are allowed")
    # Requests use big-endian length; replies use little-endian length.
    data = b"\xdc\xac\x00\x01\x01" + bytes([command])
    return data + struct.pack("<H", binascii.crc_hqx(data, 0xffff))


class Frames:
    def __init__(self):
        self.buffer = bytearray()

    def push(self, data):
        self.buffer.extend(data)
        frames = []
        while len(self.buffer) >= 2:
            start = self.buffer.find(b"\xdc\xac")
            if start < 0:
                self.buffer[:] = self.buffer[-1:] if self.buffer[-1] == 0xdc else b""
                break
            del self.buffer[:start]
            if len(self.buffer) < 5:
                break
            size = int.from_bytes(self.buffer[2:4], "little")
            if size < 1 or size > 4096:
                del self.buffer[0]
                continue
            length = size + 7
            if len(self.buffer) < length:
                break
            frame = bytes(self.buffer[:length])
            if binascii.crc_hqx(frame[:-2], 0xffff) != int.from_bytes(frame[-2:], "little"):
                del self.buffer[0]
                continue
            del self.buffer[:length]
            frames.append((frame[4], frame[5:-2]))
        return frames


def decode_status(body):
    if len(body) < 69 or body[:2] != b"\x07\x00":
        raise ValueError("Invalid controller status")
    modes = {0: "off", 1: "USB", 2: "OTG", 3: "reboot"}
    slots = [{"slot": i + 1, "boardDetected": bool(value >> 4),
              "mode": modes.get(value & 15, "unknown"), "raw": value}
             for i, value in enumerate(body[49:69])]
    return {"firmware": round(struct.unpack_from("<f", body, 6)[0], 2),
            "configuredIp": ".".join(str(x) for x in body[16:20]),
            "slots": slots, "boardCount": sum(s["boardDetected"] for s in slots),
            "usbSlotCount": sum(s["mode"] == "USB" for s in slots),
            "readAt": datetime.now(timezone.utc).isoformat()}


def discover_port():
    roots = plistlib.loads(subprocess.check_output(
        ["/usr/sbin/ioreg", "-r", "-c", "IOUSBHostDevice", "-a", "-l"], timeout=5))
    found = set()

    def walk(node, ancestors=()):
        if not isinstance(node, dict):
            return
        ancestors += ((node.get("idVendor"), node.get("idProduct")),)
        port = node.get("IOCalloutDevice")
        # CH340 belonging to a WCH phonefarm hub, rather than another serial dongle.
        if port and (0x1a86, 0x7523) in ancestors and (0x1a86, 0x8095) in ancestors:
            if port.startswith("/dev/cu.usbserial"):
                found.add(port)
        for child in node.get("IORegistryEntryChildren", []):
            walk(child, ancestors)

    for root in roots if isinstance(roots, list) else [roots]:
        walk(root)
    if len(found) != 1:
        raise RuntimeError("Pengendali box tidak ditemukan." if not found else
                           "Ada beberapa pengendali box; pembacaan otomatis dihentikan.")
    return found.pop()


def read_box():
    port = discover_port()
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    previous = termios.tcgetattr(fd)
    connected = False
    parser = Frames()

    def exchange(command, timeout=1.5):
        os.write(fd, request(command))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if select.select([fd], [], [], min(.1, max(0, deadline - time.monotonic())))[0]:
                for parent, body in parser.push(os.read(fd, 4096)):
                    if parent == 1 and len(body) >= 2 and body[0] == command:
                        if body[1] != 0:
                            raise RuntimeError("Pengendali menolak pembacaan (kode %d)." % body[1])
                        return body
        raise RuntimeError("Pengendali box belum menjawab; periksa koneksi USB.")

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        tty.setraw(fd)
        attrs = termios.tcgetattr(fd)
        attrs[4] = attrs[5] = termios.B115200
        attrs[2] |= termios.CLOCAL | termios.CREAD
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        termios.tcflush(fd, termios.TCIFLUSH)
        exchange(2)
        connected = True
        status = decode_status(exchange(7))
        return {"available": True, "port": port, **status}
    finally:
        if connected:
            try:
                exchange(3, .7)
            except (OSError, RuntimeError):
                pass
        try:
            termios.tcsetattr(fd, termios.TCSANOW, previous)
        finally:
            os.close(fd)


if __name__ == "__main__":
    try:
        if sys.platform != "darwin":
            raise RuntimeError("Pembacaan pengendali tersedia di Mac.")
        result = read_box()
    except Exception as error:
        result = {"available": False, "error": str(error)}
    print(json.dumps(result))
