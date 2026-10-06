// Everything the games draw from. Add freely; repeats are avoided per room.

export const MELD_PROMPTS = [
  'A pizza topping', 'Something in the fridge right now', 'A Disney movie', 'A color that feels happy',
  'A number between 1 and 10', 'A breakfast food', 'Something at the beach', 'A famous couple',
  'The best season', 'A dessert', 'A superpower', 'Something soft', 'A board game', 'A fruit',
  'Something red', 'An animal that is secretly evil', 'A word that rhymes with "cat"', 'A cartoon character',
  'A place for our next date', 'Something you take on a trip', 'A flower', 'A body part that is weird',
  'A vegetable', 'Something in a purse or backpack', 'A pet name for each other', 'A planet',
  'A day of the week', 'A sport', 'A kind of cake', 'Something cold', 'A city we should visit together',
  'Something that smells nice', 'A musical instrument', 'A Harry Potter character', 'An ice cream flavor',
  'A shape', 'A school subject', 'Something with wheels', 'A word for "very cute"', 'A drink',
  'Something you find in a bathroom', 'A farm animal', 'A weather word', 'A snack at the movies',
  'Something yellow', 'An emoji you use a lot', 'A holiday', 'Something you plug in', 'A sea creature',
  'A fairy tale', 'A card game', 'Something that flies', 'A month', 'A kitchen tool', 'A candy',
  'A word that means tired', 'A jungle animal', 'Something round', 'A type of shoe', 'A bird',
  'Something at a wedding', 'A sandwich', 'Something you do on a lazy Sunday', 'A pasta shape',
  'A word that starts with "love"', 'A bug', 'A gem or stone', 'Something sticky', 'A fast food chain',
  'A thing in the sky', 'Something you say when you are surprised', 'A spice', 'A piece of furniture',
  'A sound a dog makes', 'A cozy thing', 'A type of tree', 'Something in a toolbox', 'A dance',
  'A nut', 'Something green', 'A type of bread', 'A love song', 'Something that is always late',
  'A movie genre', 'A sauce', 'A reason to text each other', 'Something you lose all the time',
  'A ride at a theme park', 'A cheese', 'A mythical creature', 'Something you do when you miss me',
  'A word for a kiss', 'A piece of jewelry', 'A breakfast drink', 'A rainy day activity',
  'A Pokemon', 'A noodle dish', 'Something at a picnic', 'A thing that glows', 'A camping item',
  'A villain', 'Something you hug', 'A dream job', 'A taco topping', 'A word for "home"',
  'A fruit you put in a smoothie', 'A thing you see at night', 'A cute baby animal', 'A sleepy word',
];

// Avoid words with common anagrams so there is only one right answer.
export const SCRAMBLE_WORDS = [
  'kitten', 'cuddle', 'pillow', 'sunset', 'cookie', 'bubble', 'panda', 'honey', 'waffle', 'mochi',
  'teddy', 'puppy', 'cherry', 'picnic', 'candle', 'blanket', 'muffin', 'sprout', 'cupcake', 'garden',
  'rainbow', 'giggle', 'sweater', 'pancake', 'snuggle', 'butter', 'sparkle', 'bunny', 'velvet',
  'button', 'lemon', 'mango', 'peachy', 'cozy', 'dimple', 'kisses', 'sugar', 'marble', 'meadow',
  'cloud', 'blossom', 'cotton', 'jelly', 'pudding', 'noodle', 'flower', 'dragon', 'orbit', 'pickle',
  'wobble', 'tickle', 'sleepy', 'cocoa', 'velcro', 'lantern', 'popcorn', 'treasure', 'darling',
  'sundae', 'koala', 'penguin', 'turtle', 'otter', 'hamster', 'gentle', 'bridge', 'window',
];

export const DRAW_WORDS = [
  'cat', 'sun', 'pizza', 'heart', 'house', 'rainbow', 'snowman', 'cupcake', 'penguin', 'flower',
  'moon', 'balloon', 'ice cream', 'teddy bear', 'cloud', 'fish', 'tree', 'star', 'rocket', 'donut',
  'ghost', 'unicorn', 'turtle', 'umbrella', 'guitar', 'kiss', 'ring', 'airplane', 'cactus', 'banana',
  'bunny', 'crown', 'dog', 'duck', 'frog', 'mushroom', 'octopus', 'owl', 'panda', 'pineapple',
  'robot', 'shark', 'sloth', 'snail', 'strawberry', 'taco', 'whale', 'bicycle', 'castle', 'camera',
  'coffee', 'hamburger', 'lighthouse', 'mermaid', 'dinosaur', 'dragon', 'popcorn', 'sushi', 'volcano',
  'watermelon', 'butterfly', 'candle', 'bee', 'love letter', 'hug', 'phone call', 'airport', 'sunset',
  'birthday cake', 'snowflake', 'bed', 'pillow fight', 'cherry', 'giraffe', 'elephant', 'bow tie',
  'sandcastle', 'ferris wheel', 'tent', 'kite', 'piano', 'hot air balloon', 'fireworks', 'hedgehog',
  'boba tea', 'avocado', 'treasure map', 'spaceship', 'campfire', 'wedding', 'jellyfish', 'cupid',
];

export const COUNT_EMOJI = ['🍓', '🌸', '🐣', '🍩', '⭐', '🍄', '🐝', '🍒', '🧁', '🌈', '🐞', '🍋', '🦋', '🍉', '🐟', '🎈'];

// [base, odd one out]. Close enough to make you squint.
export const ODD_PAIRS = [
  ['🐱', '😺'], ['💗', '💖'], ['🌸', '💮'], ['🐻', '🐨'], ['🐣', '🐥'], ['🌕', '🌝'], ['⭐', '🌟'],
  ['🍊', '🍑'], ['😀', '😃'], ['😄', '😁'], ['🙂', '🙃'], ['💙', '💜'], ['🌷', '🌹'], ['🐮', '🐷'],
  ['🍎', '🍅'], ['🐶', '🐺'], ['🍪', '🍘'], ['😊', '☺️'], ['🐹', '🐭'], ['🥝', '🍈'], ['💛', '🧡'],
];

export const POKE_LINES = [
  'thinking about you 💭', 'boop! 👉👃', 'sending a tiny hug 🤗', 'come play with me 🥺',
  'miss you, cutie 💕', 'hi hi hi 👋', 'you + me = 💞', 'just a little love tap 💗',
];
