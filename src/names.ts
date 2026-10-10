import { useMemo } from 'react'
import { keccak256 } from 'viem'

// Exactly 64 entries each so a byte maps evenly (256 / 64) with no modulo bias.
const ADJ = [
  'Sleepy', 'Drowsy', 'Dreamy', 'Quiet', 'Moonlit', 'Early', 'Steady', 'Cozy',
  'Calm', 'Hushed', 'Gentle', 'Mellow', 'Snug', 'Serene', 'Placid', 'Tranquil',
  'Restful', 'Lazy', 'Slumbering', 'Dozing', 'Midnight', 'Twilight', 'Starry', 'Silent',
  'Soft', 'Velvet', 'Misty', 'Peaceful', 'Still', 'Languid', 'Hazy', 'Drifting',
  'Nocturnal', 'Lunar', 'Dusky', 'Amber', 'Patient', 'Humble', 'Weary', 'Cuddly',
  'Warm', 'Easy', 'Smooth', 'Silken', 'Balmy', 'Breezy', 'Wistful', 'Tender',
  'Evening', 'Dawn', 'Candlelit', 'Whispering', 'Hibernating', 'Nodding', 'Lulled', 'Idle',
  'Tidy', 'Content', 'Blissful', 'Sheltered', 'Curled', 'Wintry', 'Faint', 'Rested',
] as const

const NOUN = [
  'Otter', 'Owl', 'Panda', 'Koala', 'Fox', 'Heron', 'Lynx', 'Sloth',
  'Badger', 'Wren', 'Hedgehog', 'Dormouse', 'Bat', 'Moth', 'Firefly', 'Hare',
  'Deer', 'Seal', 'Swan', 'Crane', 'Dove', 'Finch', 'Robin', 'Lark',
  'Raven', 'Falcon', 'Whale', 'Dolphin', 'Manatee', 'Walrus', 'Penguin', 'Lemur',
  'Marmot', 'Beaver', 'Mole', 'Vole', 'Stoat', 'Ferret', 'Weasel', 'Gecko',
  'Newt', 'Toad', 'Tortoise', 'Turtle', 'Alpaca', 'Llama', 'Yak', 'Bison',
  'Elk', 'Moose', 'Mouse', 'Rabbit', 'Squirrel', 'Possum', 'Wombat', 'Quokka',
  'Kiwi', 'Puffin', 'Pelican', 'Ibis', 'Egret', 'Kitten', 'Pangolin', 'Okapi',
] as const

/** Deterministic anonymous name, e.g. "SleepyOtter-03BC". Same address → same name on every device. */
export function displayName(address?: string): string {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return ''
  const h = keccak256(address.toLowerCase() as `0x${string}`)
  const adj = ADJ[parseInt(h.slice(2, 4), 16) % 64]
  const noun = NOUN[parseInt(h.slice(4, 6), 16) % 64]
  return `${adj}${noun}-${address.slice(-4).toUpperCase()}`
}

export function useDisplayName(address?: string): string {
  return useMemo(() => displayName(address), [address])
}
