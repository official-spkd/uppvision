import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('read_box', Path(__file__).parents[1] / 'scripts/read-box.py')
box = importlib.util.module_from_spec(spec)
spec.loader.exec_module(box)


class ControllerProtocolTests(unittest.TestCase):
    def test_fragmented_real_controller_reply_and_bad_crc(self):
        # Successful connect response captured from the box, containing no identifiers.
        reply = bytes.fromhex('dc ac 02 00 01 02 00 d1 1d')
        corrupt = reply[:-1] + bytes([reply[-1] ^ 1])
        parser = box.Frames()
        self.assertEqual(parser.push(b'noise' + corrupt + reply[:1]), [])
        self.assertEqual(parser.push(reply[1:6]), [])
        self.assertEqual(parser.push(reply[6:]), [(1, b'\x02\x00')])

    def test_slot_presence_is_separate_from_usb_mode_and_boot(self):
        body = bytearray(70)
        body[:2] = b'\x07\x00'
        # The controller reports USB for empty slots as well as occupied slots.
        body[49:69] = bytes([1] + [17] * 18 + [1])
        status = box.decode_status(body)
        self.assertEqual(status['boardCount'], 18)
        self.assertEqual(status['usbSlotCount'], 20)
        self.assertEqual([s['slot'] for s in status['slots'] if not s['boardDetected']], [1, 20])
        self.assertNotIn('androidBooted', status['slots'][1])
        body[50] = 18
        self.assertEqual(box.decode_status(body)['slots'][1]['mode'], 'OTG')
        with self.assertRaises(ValueError):
            box.decode_status(body[:68])

    def test_requests_match_acknowledged_packets_and_reject_writes(self):
        self.assertEqual(box.request(2).hex(), 'dcac000101024b24')
        self.assertEqual(box.request(7).hex(), 'dcac00010107ee74')
        self.assertEqual(box.request(3).hex(), 'dcac000101036a34')
        for command in (0, 1, 6, 9, 10, 14, 15, 16, 17):
            with self.assertRaises(ValueError):
                box.request(command)


if __name__ == '__main__':
    unittest.main()
