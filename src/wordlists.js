// Word lists for the teacher's reading check (see teacher.html and classroom.js).

// Fry Instant Words 1–300 in frequency order, from "Fry Sight Words Listed by Frequency"
// (sightwords.com/sight-words/fry). Printed lists differ a little between editions
// ("animal" or "animals", "turn" or "turned"): change a word here to match your school's list.
export const FRY = [
  // 1–100
  'the', 'of', 'and', 'a', 'to', 'in', 'is', 'you', 'that', 'it', 'he', 'was',
  'for', 'on', 'are', 'as', 'with', 'his', 'they', 'I', 'at', 'be', 'this', 'have',
  'from', 'or', 'one', 'had', 'by', 'words', 'but', 'not', 'what', 'all', 'were', 'we',
  'when', 'your', 'can', 'said', 'there', 'use', 'an', 'each', 'which', 'she', 'do', 'how',
  'their', 'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then', 'them', 'these', 'so',
  'some', 'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look', 'two', 'more',
  'write', 'go', 'see', 'number', 'no', 'way', 'could', 'people', 'my', 'than', 'first', 'water',
  'been', 'called', 'who', 'oil', 'sit', 'now', 'find', 'long', 'down', 'day', 'did', 'get',
  'come', 'made', 'may', 'part',
  // 101–200
  'over', 'new', 'sound', 'take', 'only', 'little', 'work', 'know', 'place', 'years', 'live', 'me',
  'back', 'give', 'most', 'very', 'after', 'things', 'our', 'just', 'name', 'good', 'sentence', 'man',
  'think', 'say', 'great', 'where', 'help', 'through', 'much', 'before', 'line', 'right', 'too', 'means',
  'old', 'any', 'same', 'tell', 'boy', 'follow', 'came', 'want', 'show', 'also', 'around', 'form',
  'three', 'small', 'set', 'put', 'end', 'does', 'another', 'well', 'large', 'must', 'big', 'even',
  'such', 'because', 'turn', 'here', 'why', 'ask', 'went', 'men', 'read', 'need', 'land', 'different',
  'home', 'us', 'move', 'try', 'kind', 'hand', 'picture', 'again', 'change', 'off', 'play', 'spell',
  'air', 'away', 'animal', 'house', 'point', 'page', 'letter', 'mother', 'answer', 'found', 'study', 'still',
  'learn', 'should', 'America', 'world',
  // 201–300
  'high', 'every', 'near', 'add', 'food', 'between', 'own', 'below', 'country', 'plant', 'last', 'school',
  'father', 'keep', 'tree', 'never', 'start', 'city', 'earth', 'eyes', 'light', 'thought', 'head', 'under',
  'story', 'saw', 'left', 'don\'t', 'few', 'while', 'along', 'might', 'close', 'something', 'seem', 'next',
  'hard', 'open', 'example', 'begin', 'life', 'always', 'those', 'both', 'paper', 'together', 'got', 'group',
  'often', 'run', 'important', 'until', 'children', 'side', 'feet', 'car', 'mile', 'night', 'walk', 'white',
  'sea', 'began', 'grow', 'took', 'river', 'four', 'carry', 'state', 'once', 'book', 'hear', 'stop',
  'without', 'second', 'late', 'miss', 'idea', 'enough', 'eat', 'face', 'watch', 'far', 'Indian', 'real',
  'almost', 'let', 'above', 'girl', 'sometimes', 'mountains', 'cut', 'young', 'talk', 'soon', 'list', 'song',
  'being', 'leave', 'family', 'it\'s',
];

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** What to listen for when a child says a letter's sound (the short sound for vowels, hard c and g). */
export const SOUNDS = {
  a: 'a as in apple', b: 'b as in ball', c: 'c as in cat', d: 'd as in dog', e: 'e as in egg', f: 'f as in fish',
  g: 'g as in goat', h: 'h as in hat', i: 'i as in igloo', j: 'j as in jam', k: 'k as in kite', l: 'l as in leg',
  m: 'm as in moon', n: 'n as in nest', o: 'o as in octopus', p: 'p as in pig', q: 'qu as in queen', r: 'r as in red',
  s: 's as in sun', t: 't as in top', u: 'u as in up', v: 'v as in van', w: 'w as in web', x: 'x as in box',
  y: 'y as in yes', z: 'z as in zip',
};
