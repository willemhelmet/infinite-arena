import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
import unittest
from unittest.mock import AsyncMock
from twitch_control import TwitchControl, parse_message, outgoing_line
from episode import SPEC, compile_plan

class TwitchTests(unittest.IsolatedAsyncioTestCase):
    async def test_tagged_messages_use_stable_id_and_deduplicate(self):
        control = TwitchControl('arena', AsyncMock())
        line = '@id=abc;user-id=42 :alice!alice@host PRIVMSG #arena :!fight a turtle'
        control.accept(line); control.accept(line)
        seq, messages = await control.read_chat(0)
        self.assertEqual(seq, 1)
        self.assertEqual(messages[0]['playerId'], '42')
        self.assertEqual(messages[0]['text'], '!fight a turtle')
        self.assertIsNone(parse_message(':alice!a@h PRIVMSG #another :hi', 'arena'))

    async def test_anonymous_input_and_readonly_output(self):
        control = TwitchControl('arena', AsyncMock())
        control.accept(':alice!a@h PRIVMSG #arena :!fight turtle')
        _, messages = await control.read_chat(0)
        self.assertEqual(messages[0]['playerId'], 'alice')
        await control.say('hello')
        self.assertTrue(control._outgoing.empty())

    async def test_output_is_one_bounded_protocol_line(self):
        output = outgoing_line('arena', 'hello\r\nPRIVMSG #elsewhere :oops ' + '🐢' * 200)
        self.assertEqual(output.count(b'\r\n'), 1)
        self.assertLess(len(output), 512)
        output.decode('utf-8')

class StandaloneEpisodeTests(unittest.TestCase):
    def plan(self):
        return dict(appearanceA='a turtle monk', appearanceB='a goblin engineer', setting='a wrestling ring',
          ending='And the winner is the turtle monk!', winner='A', challengeA='Your tricks end here!', challengeB='Catch me first!',
          beats=[dict(action='The turtle changes stance', narration='The turtle anticipates a trick.', sound='crowd roar', camera=SPEC['cameras'][0]) for _ in range(12)])

    def test_stage_cast_dialogue_and_victory_without_web(self):
        plan = compile_plan(self.plan())
        self.assertEqual(sum(s['seconds'] for s in plan['shots']), 116)
        self.assertNotIn('goblin', plan['shots'][0]['prompt'])
        self.assertNotIn('turtle monk', plan['shots'][2]['prompt'])
        self.assertEqual([i for i,s in enumerate(plan['shots']) if s['dialogue']], [1,3,5])
        self.assertEqual(plan['shots'][11]['narration'], plan['ending'])
        self.assertIn('Defeated opponent: a goblin engineer', plan['shots'][11]['prompt'])
        self.assertTrue(all(len(s['prompt']) <= 800 for s in plan['shots']))

    def test_invalid_story_rejected(self):
        for patch in ({'winner':'C'}, {'beats':[]}, {'challengeA':'word ' * 12}):
            with self.assertRaises(ValueError): compile_plan({**self.plan(), **patch})
