// Layout of the ReaderBee map. All positions are given in pixel coordinates of
// assets/map.jpg (1236 x 1600) and converted to world metres (x east, z south).

export const S = 0.5, CX = 620, CY = 800;
export const P = (px, py) => [(px - CX) * S, (py - CY) * S];
export const toPx = (x, z) => [x / S + CX, z / S + CY];
const C = (pts) => pts.map(([a, b]) => P(a, b));

// Coastline: z of the shore for each x (single valued). Land is north (smaller z).
export const COAST = C([
  [-700, 1172], [190, 1172], [205, 1192], [300, 1200], [420, 1192], [480, 1182], [560, 1186],
  [632, 1180], [645, 1128], [672, 1104], [722, 1100], [752, 1114], [764, 1180],
  [850, 1212], [950, 1245], [995, 1215], [1010, 1190], [1100, 1198], [2000, 1200],
]);
// beaches in pixel-x ranges (the rest of the shore is cliff)
export const BEACHES = [[-9999, 178, 200], [1000, 1022, 9999]];

export const RIVERS = [
  {
    name: 'north', depth: 1.8, flow: 1.4,
    pts: C([[-320, 496], [120, 486], [250, 472], [330, 448], [400, 426], [520, 392], [650, 377], [790, 386], [900, 400], [1050, 396], [1560, 382]]),
    width: (x) => 13 + 17 * Math.exp(-((x - 85) ** 2) / 1800),
  },
  {
    name: 'creek', depth: 1.05, flow: 1.0,
    pts: C([[-320, 1002], [100, 992], [180, 1000], [260, 1015], [330, 1040], [430, 1062], [470, 1085], [487, 1125], [488, 1176], [490, 1240]]),
    // the WATERFALL: the creek is held up behind a rocky lip, then drops into a pool by the sea
    fall: { p: [488, 1157], lift: 0.8, pool: 0.4 },
    width: (x) => 7 + 10 * Math.exp(-((x + 195) ** 2) / 500),
  },
];

export const LAKES = [{ p: P(1040, 845), r: 12 }];

export const ROADS = [
  { name: 'Maple Lane', type: 'path', w: 4, pts: C([[60, 640], [330, 640], [420, 688], [442, 760], [470, 805]]) },
  { name: 'Meadow Road', type: 'path', w: 4, pts: C([[60, 640], [42, 700], [40, 870], [75, 915], [300, 918], [550, 920], [620, 905], [700, 893]]) },
  { name: 'Farm Road', type: 'path', w: 4, pts: C([[620, 905], [640, 830], [684, 752], [700, 680], [760, 622], [795, 560], [840, 522], [905, 524], [945, 545]]) },
  { name: 'Bridge Road', type: 'path', w: 4, pts: C([[795, 560], [800, 480], [790, 430], [790, 330], [800, 270]]) },
  { name: 'Forest Trail', type: 'path', w: 3, pts: C([[330, 640], [360, 598], [440, 560], [560, 548], [700, 512], [800, 480]]) },
  { name: 'Town Road', type: 'road', w: 6, pts: C([[550, 920], [565, 970], [600, 1025]]) },
  { name: 'Coast Road', type: 'road', w: 6.5, pts: C([[-80, 1085], [150, 1092], [300, 1115], [430, 1126], [540, 1128], [580, 1095], [600, 1025], [780, 1025], [800, 1090]]) },
  { name: 'Harbor Street', type: 'road', w: 6, pts: C([[670, 1012], [670, 1098]]) },
  { name: 'Valley Road', type: 'path', w: 4, pts: C([[1340, 520], [1180, 530], [1140, 565], [1080, 622], [1010, 690], [952, 770], [945, 840], [990, 880], [1120, 885], [1165, 920], [1140, 960], [1010, 990], [975, 1040], [990, 1080], [1040, 1098]]) },
  { name: 'School Path', type: 'path', w: 3.5, pts: C([[700, 893], [820, 890], [945, 860]]) },
  { name: 'Tractor Lane', type: 'path', w: 3.5, pts: C([[780, 590], [860, 645]]) },
  { name: 'Gas Lane', type: 'path', w: 4, pts: C([[720, 660], [778, 698]]) },
  { name: 'Barn Lane', type: 'path', w: 3.5, pts: C([[1010, 690], [1080, 748]]) },
  { name: 'Lighthouse Path', type: 'path', w: 3, pts: C([[300, 1115], [292, 1150]]) },
  { name: 'Park Path', type: 'path', w: 3, pts: C([[160, 640], [160, 606]]) },
];

// Flattened building plots. `building` plots get no grass.
export const SITES = {
  ranch: { p: [155, 700], w: 30, d: 24, building: true },
  twostory: { p: [360, 690], w: 18, d: 18, building: true },
  brickCottage: { p: [200, 842], w: 18, d: 14, building: true },
  blueCottage: { p: [320, 842], w: 13, d: 12, building: true },
  coop: { p: [512, 812], w: 18, d: 16 },
  stoneCottage: { p: [565, 512], w: 22, d: 16, building: true },
  redwoodHouse: { p: [432, 522], w: 14, d: 14 },
  treehouse: { p: [350, 550], w: 20, d: 20 },
  treehouseRamp: { p: [363, 585], w: 7, d: 32 },
  oakTree: { p: [655, 620], w: 16, d: 16 },
  park: { p: [160, 585], w: 26, d: 18 },
  gas: { p: [800, 700], w: 26, d: 20, building: true },
  tractor: { p: [890, 635], w: 26, d: 20, building: true },
  barn: { p: [1110, 760], w: 26, d: 30, building: true },
  silo: { p: [1080, 700], w: 9, d: 9, building: true },
  shed: { p: [1030, 780], w: 9, d: 8, building: true },
  school: { p: [760, 856], w: 38, d: 22, building: true },
  lighthouse: { p: [285, 1135], w: 10, d: 10, building: true },
  keeper: { p: [245, 1140], w: 11, d: 9, building: true },
  town: { p: [675, 1040], w: 112, d: 52, blend: 14 }, // a long gentle slope, so the road into town can be walked back up
  sealcove: { p: [1110, 1105], w: 44, d: 18 },
  treefarm: { p: [995, 505], w: 60, d: 40 },
  orchard: { p: [530, 670], w: 38, d: 26 },
  city: { p: [905, 245], w: 200, d: 64 },
  log: { p: [750, 492], w: 16, d: 8 },
};

// Ground colour patches (no grass).
export const PATCHES = [
  { p: [530, 670], w: 34, d: 22, kind: 'dirt' },
  { p: [515, 815], w: 15, d: 13, kind: 'dirt' },
  { p: [100, 855], w: 20, d: 10, kind: 'soil' },
  { p: [375, 852], w: 10, d: 7, kind: 'soil' },
  { p: [160, 584], w: 14, d: 9, kind: 'mulch' },
  { p: [1078, 772], w: 30, d: 24, kind: 'dirt' },
  { p: [995, 505], w: 56, d: 38, kind: 'snow' },
  { p: [760, 880], w: 34, d: 10, kind: 'pave' },
  { p: [800, 700], w: 26, d: 18, kind: 'asphalt' },
  { p: [890, 650], w: 24, d: 16, kind: 'gravel' },
  { p: [675, 1036], w: 104, d: 44, kind: 'pave' },
  { p: [905, 245], w: 200, d: 64, kind: 'pave' },
  { p: [1100, 1110], w: 30, d: 10, kind: 'dirt' },
];

// Places to discover. Each has a word to read, a short sentence, how a quest asks for it (find, with the word in
// capitals), and a phonics level for the quest order: 1 short words (log, gas), 2 vowel teams and r (barn, seal),
// 3 two syllables (garden), 4 tricky spellings (blue, school), 5 long words (library).
export const LANDMARKS = [
  { id: 'treehouse', name: 'Tree House', p: [350, 560], r: 20, word: 'TREE HOUSE', find: 'the TREE HOUSE', tier: 3, say: 'The kids play in the big tree house.' },
  { id: 'park', name: 'Park', p: [160, 585], r: 16, word: 'PARK', find: 'the PARK', tier: 2, say: 'Swing up high at the park!' },
  { id: 'dragons', name: 'Dragon Cliffs', p: [190, 480], r: 30, word: 'DRAGONS', find: 'the DRAGONS', tier: 3, say: 'Dragons fly by the cliff caves.' },
  { id: 'cottage', name: 'Stone Cottage', p: [565, 512], r: 16, word: 'COTTAGE', find: 'the stone COTTAGE', tier: 4, say: 'The stone cottage has a grass roof.' },
  { id: 'trunkhouse', name: 'Trunk House', p: [432, 522], r: 12, word: 'DOOR', find: 'the little DOOR in a tree', tier: 4, say: 'A little door is in the tree.' },
  { id: 'log', name: 'Hollow Log', p: [750, 492], r: 12, word: 'LOG', find: 'the hollow LOG', tier: 1, say: 'You can walk in the log!' },
  { id: 'bridge', name: 'Big Bridge', p: [790, 400], r: 26, word: 'BRIDGE', find: 'the big BRIDGE', tier: 4, say: 'Cross the big bridge to the city.' },
  { id: 'city', name: 'City', p: [905, 255], r: 50, word: 'CITY', find: 'the CITY', tier: 4, say: 'The city has tall buildings.' },
  { id: 'windmills', name: 'Windmills', p: [225, 330], r: 85, word: 'WIND', find: 'the WINDmills', tier: 1, say: 'The wind spins the windmills.' },
  { id: 'treefarm', name: "Benny's Tree Farm", p: [1000, 510], r: 28, word: 'TREE FARM', find: 'the TREE FARM', tier: 3, say: 'Benny grows Christmas trees.' },
  { id: 'tractor', name: 'Tractor School', p: [890, 640], r: 15, word: 'TRACTOR', find: 'the TRACTOR school', tier: 3, say: 'Big tractors dig in the dirt.' },
  { id: 'gas', name: 'Gas Station', p: [800, 700], r: 14, word: 'GAS', find: 'the GAS station', tier: 1, say: 'Cars and trucks get gas here.' },
  { id: 'oaktree', name: 'Oak Tree House', p: [655, 620], r: 12, word: 'OAK TREE', find: 'the OAK TREE house', tier: 3, say: 'A red house sits in the oak tree.' },
  { id: 'orchard', name: 'Apple Orchard', p: [530, 670], r: 20, word: 'APPLES', find: 'the APPLES', tier: 3, say: 'Red apples grow on the trees.' },
  { id: 'ranch', name: 'Red Roof House', p: [155, 700], r: 15, word: 'HOUSE', find: 'the HOUSE with a red roof', tier: 4, say: 'This house has a red roof.' },
  { id: 'porch', name: 'Porch House', p: [360, 690], r: 13, word: 'PORCH', find: 'the PORCH', tier: 2, say: 'Sit on the porch and read.' },
  { id: 'coop', name: 'Chicken Coop', p: [512, 812], r: 13, word: 'HENS', find: 'the HENS', tier: 1, say: 'The hens lay eggs in the coop.' },
  { id: 'garden', name: 'Garden', p: [110, 852], r: 15, word: 'GARDEN', find: 'the GARDEN', tier: 3, say: 'Carrots grow in the garden.' },
  { id: 'bluehouse', name: 'Blue House', p: [320, 842], r: 11, word: 'BLUE', find: 'the BLUE house', tier: 4, say: 'The little house has a blue roof.' },
  { id: 'barn', name: 'Red Barn', p: [1110, 760], r: 18, word: 'BARN', find: 'the red BARN', tier: 2, say: 'The big red barn is on the farm.' },
  { id: 'cows', name: 'Cows', p: [1165, 670], r: 22, word: 'COWS', find: 'the COWS', tier: 2, say: 'Moo! The cows eat green grass.' },
  { id: 'horse', name: 'Horse', p: [1160, 845], r: 15, word: 'HORSE', find: 'the HORSE', tier: 2, say: 'The horse can run fast.' },
  { id: 'pond', name: 'Duck Pond', p: [1040, 845], r: 16, word: 'DUCKS', find: 'the DUCKS', tier: 1, say: 'Ducks swim in the pond.' },
  { id: 'bees', name: 'Bee Hives', p: [1192, 788], r: 9, word: 'BEES', find: 'the BEES', tier: 2, say: 'Buzz! The bees make honey.' },
  { id: 'school', name: 'School', p: [760, 870], r: 20, word: 'SCHOOL', find: 'the SCHOOL', tier: 4, say: 'We learn to read at school.' },
  { id: 'balloon', name: 'Hot Air Balloon', p: [945, 965], r: 18, word: 'BALLOON', find: 'the hot air BALLOON', tier: 3, say: 'The balloon floats up in the sky.' },
  { id: 'bank', name: 'Bank', p: [700, 1000], r: 12, word: 'BANK', find: 'the BANK', tier: 1, say: 'Save your coins at the bank.' },
  { id: 'books', name: 'Book Shop', p: [640, 1000], r: 12, word: 'BOOKS', find: 'the shop with BOOKS', tier: 2, say: 'Find a good book to read.' },
  { id: 'library', name: 'Library', p: [600, 1050], r: 12, word: 'LIBRARY', find: 'the LIBRARY', tier: 5, say: 'Shh! Read quietly in the library.' },
  { id: 'harbor', name: 'Harbor', p: [700, 1140], r: 22, word: 'BOATS', find: 'the BOATS', tier: 2, say: 'The boats rest in the harbor.' },
  { id: 'lighthouse', name: 'Lighthouse', p: [285, 1135], r: 16, word: 'LIGHTHOUSE', find: 'the LIGHTHOUSE', tier: 5, say: 'The light helps ships at night.' },
  { id: 'eseals', name: 'Elephant Seals', p: [110, 1135], r: 26, word: 'SEALS', find: 'the big SEALS on the sand', tier: 2, say: 'Big elephant seals nap on the sand.' },
  { id: 'beaver', name: 'Beaver Dam', p: [230, 1000], r: 18, word: 'BEAVER', find: 'the BEAVER dam', tier: 3, say: 'The beaver builds a dam with sticks.' },
  { id: 'waterfall', name: 'Waterfall', p: [487, 1160], r: 14, word: 'WATERFALL', find: 'the WATERFALL', tier: 5, say: 'Splash! The water falls into the sea.' },
  { id: 'whale', name: 'Whale', p: [450, 1215], r: 45, word: 'WHALE', find: 'the WHALE', tier: 2, say: 'Look! A whale swims in the sea.' },
  { id: 'sealcove', name: 'Seal Cove', p: [1110, 1100], r: 22, word: 'SEAL COVE', find: 'SEAL COVE', tier: 3, say: 'Camp and have a picnic at Seal Cove.' },
  { id: 'sealrock', name: 'Seal Rock', p: [950, 1225], r: 30, word: 'SEAL', find: 'the SEAL on the rock', tier: 2, say: 'A seal sits on the rock.' },
];

// Forest scatter regions (pixel rects: x0, y0, x1, y1).
export const FORESTS = [
  { kind: 'redwood', r: [190, 380, 700, 535], n: 300 },
  { kind: 'redwood', r: [830, 400, 1250, 610], n: 330 },
  { kind: 'redwood', r: [330, 945, 480, 1110], n: 90 },
  { kind: 'redwood', r: [805, 1000, 1000, 1205], n: 130 },
  { kind: 'redwood', r: [1055, 945, 1250, 1110], n: 90 },
  { kind: 'hillpine', r: [-120, 280, 330, 478], n: 800 },
  { kind: 'fir', r: [300, 170, 860, 372], n: 420 },
  { kind: 'fir', r: [1060, 150, 1560, 372], n: 340 },
  { kind: 'fir', r: [-320, 80, 300, 300], n: 300 },
  { kind: 'redwood', r: [-340, 470, 0, 1150], n: 420 },
  { kind: 'redwood', r: [1240, 470, 1580, 1150], n: 420 },
  { kind: 'fir', r: [-340, -120, 1600, 160], n: 700 },
  { kind: 'oak', r: [40, 600, 1200, 960], n: 45 },
];

// Hand-placed shade trees (pixels).
export const OAKS = [
  [205, 650], [92, 700], [255, 690], [420, 655], [300, 745], [290, 820], [150, 800], [600, 760],
  [870, 905], [440, 870], [560, 880], [735, 790], [1000, 925], [935, 700], [1180, 735], [640, 960],
  [240, 600], [60, 820], [990, 640], [860, 790],
];
