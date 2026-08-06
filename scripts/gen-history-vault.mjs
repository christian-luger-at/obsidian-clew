#!/usr/bin/env node
// A large, thematically coherent "World History" vault - built specifically
// so docs/README screenshots (scripts/screenshots.mjs) show a rich,
// organic-looking graph instead of the small hand-crafted functional test
// vault (gen-test-vault.mjs), which stays exactly as-is: DEVELOPMENT.md's
// entire manual QA checklist depends on its precise note names ("Bridge
// Note", "Island X", "Old Cluster A", ...), so this is a genuinely separate
// vault, not a replacement.
//
// World history specifically (not e.g. world geography) because it's the
// one subject that plays to every one of Clew's own features at once: real
// per-note years give the Timeline replay actual chronological meaning
// instead of an arbitrary backdate; 23 era/civilization "hub" notes plus a
// chronological hub-to-hub chain produce natural high-degree hubs and a
// single connected graph (not 23 disconnected star clusters); a handful of
// hand-picked cross-era links (Caesar<->Cleopatra, Hitler<->Treaty of
// Versailles, ...) give Find-path's hub-avoidance cost model real
// non-trivial alternate routes to surface, not just the hub->hub path; and
// `era`/`region`/`period`/`year` frontmatter gives Filter/Color & size both
// categorical properties (era/region/period) and a numeric one (year) to
// encode by - `period` (Ancient/Medieval/Early Modern/Modern/Contemporary)
// also matches each note's own folder (PERIOD_FOLDER below), so a `folder`
// criterion and a `property: period` criterion demo the same grouping two
// different ways.
//
// Same "generated, not committed" reasoning as gen-test-vault.mjs: mtime is
// filesystem metadata git can't preserve across a clone.
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'history-vault';
const FOLDER = 'History';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

rmSync(join(ROOT, FOLDER), { recursive: true, force: true });
rmSync(join(ROOT, 'attachments'), { recursive: true, force: true });
mkdirSync(join(ROOT, FOLDER), { recursive: true });
mkdirSync(join(ROOT, 'attachments'), { recursive: true });

function coverSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="hsl(35,80%,50%)"/></svg>\n`;
}
writeFileSync(join(ROOT, 'attachments', 'cover.svg'), coverSvg());

/**
 * @typedef {{ name: string, region: string, period: string, blurb: string }} Category
 * @typedef {{ name: string, year: number, category: string, summary: string, cover?: boolean }} Entry
 */

/** @type {Category[]} */
const CATEGORIES = [
	{ name: 'Prehistory & Early Humans', region: 'Global', period: 'Ancient', blurb: 'From the emergence of anatomically modern humans to the first cities and the invention of writing.' },
	{ name: 'Ancient Mesopotamia', region: 'Middle East', period: 'Ancient', blurb: "The 'cradle of civilization' between the Tigris and Euphrates, home to the first cities, laws, and empires." },
	{ name: 'Ancient Egypt', region: 'Africa', period: 'Ancient', blurb: 'A civilization along the Nile that endured for three millennia, famed for its pyramids and pharaohs.' },
	{ name: 'Ancient India', region: 'Asia', period: 'Ancient', blurb: 'From the Indus Valley cities to the great empires and religions that shaped the subcontinent.' },
	{ name: 'Ancient China', region: 'Asia', period: 'Ancient', blurb: 'A succession of dynasties, philosophies, and inventions spanning millennia of Chinese civilization.' },
	{ name: 'Ancient Greece', region: 'Europe', period: 'Ancient', blurb: 'City-states, philosophers, and conquerors whose ideas underpin much of Western civilization.' },
	{ name: 'Roman Republic & Empire', region: 'Europe', period: 'Ancient', blurb: 'From a small city-state to a Mediterranean superpower whose law, language, and roads outlasted it.' },
	{ name: 'Byzantine Empire', region: 'Europe', period: 'Medieval', blurb: "The Roman Empire's eastern continuation, centered on Constantinople, lasting over a thousand years." },
	{ name: 'Islamic Golden Age', region: 'Middle East', period: 'Medieval', blurb: 'A flourishing of science, philosophy, and culture across the early Islamic caliphates.' },
	{ name: 'Medieval Europe', region: 'Europe', period: 'Medieval', blurb: 'Feudal kingdoms, crusades, plague, and cathedrals between Rome\'s fall and the Renaissance.' },
	{ name: 'Mongol Empire', region: 'Asia', period: 'Medieval', blurb: 'The largest contiguous land empire in history, forged by Genghis Khan and his successors.' },
	{ name: 'Pre-Columbian Americas', region: 'Americas', period: 'Medieval', blurb: 'Independent American civilizations - Maya, Aztec, Inca, and others - before European contact.' },
	{ name: 'Renaissance', region: 'Europe', period: 'Early Modern', blurb: "A rebirth of classical learning, art, and humanist thought, radiating out from Italy." },
	{ name: 'Age of Exploration', region: 'Global', period: 'Early Modern', blurb: "European sea voyages that connected - and violently reshaped - the whole world." },
	{ name: 'Scientific Revolution', region: 'Europe', period: 'Early Modern', blurb: 'A transformation in how nature was studied, from Copernicus to Newton.' },
	{ name: 'Enlightenment', region: 'Europe', period: 'Early Modern', blurb: 'Philosophers championing reason, natural rights, and government by consent.' },
	{ name: 'Age of Revolutions', region: 'Global', period: 'Early Modern', blurb: 'American, French, and Latin American revolutions that toppled old orders and inspired new nations.' },
	{ name: 'Industrial Revolution', region: 'Europe', period: 'Modern', blurb: 'Steam, factories, and new science that transformed economies and everyday life.' },
	{ name: 'Imperialism & Colonial Empires', region: 'Global', period: 'Modern', blurb: 'European powers carving up Africa and Asia, reshaping the modern map.' },
	{ name: 'World War I Era', region: 'Global', period: 'Modern', blurb: 'A war of unprecedented scale that shattered old empires and redrew borders.' },
	{ name: 'World War II Era', region: 'Global', period: 'Modern', blurb: "History's deadliest conflict, and the atrocities and turning points that defined it." },
	{ name: 'Cold War Era', region: 'Global', period: 'Contemporary', blurb: 'Four decades of superpower rivalry, proxy wars, and a race to the Moon.' },
	{ name: 'Contemporary Era', region: 'Global', period: 'Contemporary', blurb: 'The interconnected, digital world since the Cold War\'s end.' },
];

// Chronological "spine" - each hub links to the next, keeping the whole
// vault one connected graph (not 23 disconnected star clusters) and giving
// Find-path plenty of long, genuinely interesting routes to search between.
const HUB_CHAIN = [
	'Prehistory & Early Humans',
	'Ancient Mesopotamia',
	'Ancient Egypt',
	'Ancient India',
	'Ancient China',
	'Ancient Greece',
	'Roman Republic & Empire',
	'Byzantine Empire',
	'Islamic Golden Age',
	'Medieval Europe',
	'Mongol Empire',
	'Pre-Columbian Americas',
	'Renaissance',
	'Age of Exploration',
	'Scientific Revolution',
	'Enlightenment',
	'Age of Revolutions',
	'Industrial Revolution',
	'Imperialism & Colonial Empires',
	'World War I Era',
	'World War II Era',
	'Cold War Era',
	'Contemporary Era',
];

/** @type {Entry[]} */
const ENTRIES = [
	// --- Prehistory & Early Humans ---
	{ name: 'Homo Sapiens Emergence', year: -300000, category: 'Prehistory & Early Humans', summary: 'Anatomically modern humans first appear in Africa, later spreading across the globe.' },
	{ name: 'Cave Paintings of Lascaux', year: -17000, category: 'Prehistory & Early Humans', summary: 'Paleolithic humans in France create elaborate animal paintings deep inside limestone caves.' },
	{ name: 'Agricultural Revolution', year: -10000, category: 'Prehistory & Early Humans', summary: 'Humans in the Fertile Crescent begin domesticating plants and animals, ending nomadic life.' },
	{ name: 'Göbekli Tepe', year: -9600, category: 'Prehistory & Early Humans', summary: 'Hunter-gatherers in Anatolia build the oldest known monumental stone temple complex.' },
	{ name: 'Bronze Age Begins', year: -3300, category: 'Prehistory & Early Humans', summary: 'The widespread use of bronze tools and weapons marks a new technological era across Eurasia.' },
	{ name: 'Invention of Writing', year: -3200, category: 'Prehistory & Early Humans', summary: 'Cuneiform script develops in Sumer, the earliest known system of writing.' },

	// --- Ancient Mesopotamia ---
	{ name: 'Sumer', year: -4500, category: 'Ancient Mesopotamia', summary: "The world's first cities and city-states arise in southern Mesopotamia." },
	{ name: 'Uruk', year: -4000, category: 'Ancient Mesopotamia', summary: 'One of the earliest and largest Sumerian cities, often called the first true city.' },
	{ name: 'Epic of Gilgamesh', year: -2100, category: 'Ancient Mesopotamia', summary: 'One of the earliest surviving works of literature, recounting the legendary king of Uruk.' },
	{ name: 'Code of Hammurabi', year: -1754, category: 'Ancient Mesopotamia', summary: 'Babylonian king Hammurabi issues one of the earliest and most complete written legal codes.' },
	{ name: 'Babylon', year: -1894, category: 'Ancient Mesopotamia', summary: "A Mesopotamian city that rose to become one of the ancient world's great imperial capitals." },
	{ name: 'Assyrian Empire', year: -911, category: 'Ancient Mesopotamia', summary: 'A militaristic empire that dominated the Near East through conquest and innovative administration.' },
	{ name: 'Nebuchadnezzar II', year: -605, category: 'Ancient Mesopotamia', summary: "Babylonian king credited with the city's Hanging Gardens and the conquest of Jerusalem." },
	{ name: 'Hanging Gardens of Babylon', year: -600, category: 'Ancient Mesopotamia', summary: 'A legendary garden terrace said to be one of the Seven Wonders of the Ancient World.' },
	{ name: 'Cyrus the Great', year: -559, category: 'Ancient Mesopotamia', summary: 'Founder of the Achaemenid Persian Empire, known for tolerant rule over conquered peoples.' },
	{ name: 'Persian Empire', year: -550, category: 'Ancient Mesopotamia', summary: 'The Achaemenid Empire becomes the largest empire the ancient world had yet seen.' },

	// --- Ancient Egypt ---
	{ name: 'Narmer', year: -3100, category: 'Ancient Egypt', summary: 'Traditionally credited with unifying Upper and Lower Egypt into a single kingdom.' },
	{ name: 'Old Kingdom Egypt', year: -2686, category: 'Ancient Egypt', summary: "The 'Age of the Pyramids', when Egypt's pharaohs built the great pyramids of Giza." },
	{ name: 'Great Pyramid of Giza', year: -2560, category: 'Ancient Egypt', summary: 'Built for Pharaoh Khufu, it remained the tallest man-made structure for nearly 4,000 years.', cover: true },
	{ name: 'Sphinx of Giza', year: -2500, category: 'Ancient Egypt', summary: "A limestone statue with a lion's body and a human head, guarding the Giza pyramid complex." },
	{ name: 'Middle Kingdom Egypt', year: -2055, category: 'Ancient Egypt', summary: "A period of reunification and cultural flourishing after Egypt's First Intermediate Period." },
	{ name: 'Hatshepsut', year: -1507, category: 'Ancient Egypt', summary: 'One of the few female pharaohs, known for extensive trade expeditions and building projects.' },
	{ name: 'Akhenaten', year: -1353, category: 'Ancient Egypt', summary: 'Pharaoh who briefly imposed worship of a single sun god, Aten, reshaping Egyptian religion.' },
	{ name: 'Tutankhamun', year: -1332, category: 'Ancient Egypt', summary: 'Boy pharaoh whose largely intact tomb, discovered in 1922, revealed extraordinary treasures.' },
	{ name: 'Ramesses II', year: -1279, category: 'Ancient Egypt', summary: "One of Egypt's most powerful pharaohs, known for monumental building and the Battle of Kadesh." },
	{ name: 'New Kingdom Egypt', year: -1550, category: 'Ancient Egypt', summary: "Egypt's imperial age, when its territory and influence reached their greatest extent." },
	{ name: 'Rosetta Stone', year: -196, category: 'Ancient Egypt', summary: 'A trilingual inscription that later allowed scholars to decipher Egyptian hieroglyphs.' },
	{ name: 'Cleopatra VII', year: -51, category: 'Ancient Egypt', summary: "The last active ruler of the Ptolemaic Kingdom of Egypt, allied with Rome's Caesar and Antony." },

	// --- Ancient India ---
	{ name: 'Indus Valley Civilization', year: -3300, category: 'Ancient India', summary: 'A Bronze Age civilization along the Indus River, notable for advanced urban planning.' },
	{ name: 'Mohenjo-daro', year: -2500, category: 'Ancient India', summary: 'One of the largest Indus Valley cities, with sophisticated drainage and grid-planned streets.' },
	{ name: 'Vedic Period', year: -1500, category: 'Ancient India', summary: 'Indo-Aryan migrations into India and the composition of the Vedas, foundational Hindu scriptures.' },
	{ name: 'Siddhartha Gautama (the Buddha)', year: -563, category: 'Ancient India', summary: 'Founder of Buddhism, who taught a path to liberation from suffering.' },
	{ name: 'Maurya Empire', year: -321, category: 'Ancient India', summary: 'The first empire to unify most of the Indian subcontinent, under rulers like Ashoka.' },
	{ name: 'Ashoka the Great', year: -268, category: 'Ancient India', summary: 'Mauryan emperor who embraced Buddhism and promoted nonviolence after a brutal conquest.' },
	{ name: 'Gupta Empire', year: 320, category: 'Ancient India', summary: "Often called India's 'Golden Age', a period of major advances in science, math, and the arts." },
	{ name: 'Aryabhata', year: 476, category: 'Ancient India', summary: 'Indian mathematician and astronomer who proposed a heliocentric model and calculated pi.' },
	{ name: 'Delhi Sultanate', year: 1206, category: 'Ancient India', summary: 'A series of Muslim dynasties ruling large parts of the Indian subcontinent for centuries.' },
	{ name: 'Mughal Empire', year: 1526, category: 'Ancient India', summary: 'A powerful Islamic empire in India known for architectural achievements like the Taj Mahal.' },

	// --- Ancient China ---
	{ name: 'Xia Dynasty', year: -2070, category: 'Ancient China', summary: "Traditionally China's first dynasty, though its historicity remains debated." },
	{ name: 'Shang Dynasty', year: -1600, category: 'Ancient China', summary: "China's earliest dynasty with confirmed written records, using oracle bones for divination." },
	{ name: 'Zhou Dynasty', year: -1046, category: 'Ancient China', summary: "China's longest-lasting dynasty, which introduced the Mandate of Heaven concept of rulership." },
	{ name: 'Confucius', year: -551, category: 'Ancient China', summary: 'Chinese philosopher whose teachings on ethics and social harmony shaped East Asian culture.' },
	{ name: 'Laozi', year: -500, category: 'Ancient China', summary: 'Traditionally credited as the founder of Taoism and author of the Tao Te Ching.' },
	{ name: 'Warring States Period', year: -475, category: 'Ancient China', summary: 'A turbulent era of rival Chinese states competing for dominance before unification.' },
	{ name: 'Qin Shi Huang', year: -221, category: 'Ancient China', summary: 'First emperor of a unified China, who standardized writing, currency, and began the Great Wall.' },
	{ name: 'Terracotta Army', year: -210, category: 'Ancient China', summary: "Thousands of life-sized clay soldiers buried to guard Qin Shi Huang's tomb." },
	{ name: 'Han Dynasty', year: -206, category: 'Ancient China', summary: 'A golden age of Chinese civilization that established the Silk Road trade routes.' },
	{ name: 'Silk Road', year: -130, category: 'Ancient China', summary: 'A network of trade routes connecting China to the Mediterranean, exchanging goods and ideas.' },
	{ name: 'Tang Dynasty', year: 618, category: 'Ancient China', summary: 'Widely regarded as a high point of Chinese civilization in cosmopolitanism and poetry.' },
	{ name: 'Song Dynasty', year: 960, category: 'Ancient China', summary: 'An era of major innovation, including movable-type printing and gunpowder weapons.' },

	// --- Ancient Greece ---
	{ name: 'Minoan Civilization', year: -2700, category: 'Ancient Greece', summary: "A Bronze Age civilization on Crete, considered Europe's first advanced civilization." },
	{ name: 'Mycenaean Greece', year: -1600, category: 'Ancient Greece', summary: "The first advanced civilization on the Greek mainland, later inspiring Homer's epics." },
	{ name: 'Trojan War', year: -1200, category: 'Ancient Greece', summary: "A legendary conflict between Greeks and the city of Troy, immortalized in Homer's Iliad." },
	{ name: 'Homer', year: -800, category: 'Ancient Greece', summary: 'Greek poet traditionally credited with the Iliad and Odyssey, foundational Western texts.' },
	{ name: 'Founding of Rome', year: -753, category: 'Ancient Greece', summary: 'According to legend, the city of Rome is founded by Romulus.' },
	{ name: 'Sparta', year: -900, category: 'Ancient Greece', summary: 'A militaristic Greek city-state famous for its rigorous warrior culture and disciplined army.' },
	{ name: 'Athens', year: -508, category: 'Ancient Greece', summary: 'A Greek city-state that pioneered democracy and became a center of philosophy and the arts.' },
	{ name: "Solon's Reforms", year: -594, category: 'Ancient Greece', summary: 'Athenian statesman whose legal and economic reforms laid groundwork for later democracy.' },
	{ name: 'Cleisthenes', year: -508, category: 'Ancient Greece', summary: "Athenian reformer often called the 'father of Athenian democracy'." },
	{ name: 'Persian Wars', year: -499, category: 'Ancient Greece', summary: 'A series of conflicts in which Greek city-states repelled invasions by the Persian Empire.' },
	{ name: 'Battle of Marathon', year: -490, category: 'Ancient Greece', summary: 'Athens defeats a much larger Persian invasion force, becoming a symbol of Greek resistance.' },
	{ name: 'Battle of Thermopylae', year: -480, category: 'Ancient Greece', summary: 'A small Spartan-led force makes a legendary last stand against the Persian army.' },
	{ name: 'Golden Age of Athens', year: -461, category: 'Ancient Greece', summary: 'Under Pericles, Athens reaches its height in democracy, philosophy, drama, and architecture.' },
	{ name: 'Parthenon', year: -447, category: 'Ancient Greece', summary: 'A temple to Athena built atop the Acropolis, an enduring symbol of classical architecture.' },
	{ name: 'Socrates', year: -470, category: 'Ancient Greece', summary: "Athenian philosopher whose method of questioning laid the foundations of Western philosophy." },
	{ name: 'Plato', year: -428, category: 'Ancient Greece', summary: 'Student of Socrates who founded the Academy and wrote foundational works of philosophy.' },
	{ name: 'Aristotle', year: -384, category: 'Ancient Greece', summary: 'Polymath philosopher who tutored Alexander the Great and shaped nearly every field of thought.' },
	{ name: 'Alexander the Great', year: -356, category: 'Ancient Greece', summary: 'Macedonian king who built one of history\'s largest empires by age thirty.' },

	// --- Roman Republic & Empire ---
	{ name: 'Roman Republic Founded', year: -509, category: 'Roman Republic & Empire', summary: 'Rome overthrows its monarchy, establishing a republic governed by elected officials and the Senate.' },
	{ name: 'Twelve Tables', year: -451, category: 'Roman Republic & Empire', summary: "Rome's earliest attempt to codify law, publicly displayed for all citizens to see." },
	{ name: 'Punic Wars', year: -264, category: 'Roman Republic & Empire', summary: 'A series of wars between Rome and Carthage that established Rome as the dominant Mediterranean power.' },
	{ name: 'Hannibal', year: -247, category: 'Roman Republic & Empire', summary: 'Carthaginian general who famously led an army, with war elephants, across the Alps into Italy.' },
	{ name: 'Julius Caesar', year: -100, category: 'Roman Republic & Empire', summary: "Roman general and statesman whose rise to power ended the Republic and paved the way for empire." },
	{ name: 'Crossing the Rubicon', year: -49, category: 'Roman Republic & Empire', summary: "Caesar's illegal march on Rome with his army triggers a civil war." },
	{ name: 'Assassination of Caesar', year: -44, category: 'Roman Republic & Empire', summary: 'Caesar is murdered by Roman senators fearing his growing autocratic power.' },
	{ name: 'Cleopatra and Mark Antony', year: -41, category: 'Roman Republic & Empire', summary: 'The Egyptian queen allies with Roman general Mark Antony against Octavian.' },
	{ name: 'Augustus', year: -63, category: 'Roman Republic & Empire', summary: "Rome's first emperor, who ended a century of civil war and began the Pax Romana." },
	{ name: 'Pax Romana', year: -27, category: 'Roman Republic & Empire', summary: 'A roughly 200-year period of relative peace and stability across the Roman Empire.' },
	{ name: 'Roman Colosseum', year: 80, category: 'Roman Republic & Empire', summary: 'A vast amphitheater in Rome built for gladiatorial contests and public spectacles.' },
	{ name: 'Roman Roads', year: -312, category: 'Roman Republic & Empire', summary: 'An extensive network of engineered roads that connected and unified the vast empire.' },
	{ name: 'Constantine the Great', year: 272, category: 'Roman Republic & Empire', summary: 'Roman emperor who legalized Christianity and founded Constantinople as a new capital.' },
	{ name: 'Edict of Milan', year: 313, category: 'Roman Republic & Empire', summary: 'Constantine grants religious tolerance throughout the Roman Empire, ending Christian persecution.' },
	{ name: 'Council of Nicaea', year: 325, category: 'Roman Republic & Empire', summary: 'The first major Christian council, establishing core doctrine still recited today.' },
	{ name: 'Division of the Roman Empire', year: 395, category: 'Roman Republic & Empire', summary: 'The empire permanently splits into Western and Eastern halves after Theodosius\'s death.' },
	{ name: 'Fall of the Western Roman Empire', year: 476, category: 'Roman Republic & Empire', summary: 'The last Western Roman emperor is deposed, traditionally marking the end of ancient Rome.' },
	{ name: 'Attila the Hun', year: 434, category: 'Roman Republic & Empire', summary: 'Leader of the Huns whose invasions helped destabilize the late Western Roman Empire.' },
	{ name: 'Roman Aqueducts', year: -312, category: 'Roman Republic & Empire', summary: 'Engineering marvels that carried fresh water across great distances to Roman cities.' },
	{ name: 'Virgil', year: -70, category: 'Roman Republic & Empire', summary: 'Roman poet whose epic the Aeneid became a foundational text of Roman identity.' },

	// --- Byzantine Empire ---
	{ name: 'Constantinople Founded', year: 330, category: 'Byzantine Empire', summary: 'Constantine establishes a new eastern capital, later the heart of the Byzantine Empire.' },
	{ name: 'Justinian I', year: 482, category: 'Byzantine Empire', summary: 'Byzantine emperor who reconquered lost Roman territory and codified Roman law.' },
	{ name: 'Hagia Sophia', year: 537, category: 'Byzantine Empire', summary: 'A monumental cathedral in Constantinople, an architectural marvel of the Byzantine world.' },
	{ name: "Justinian's Code", year: 529, category: 'Byzantine Empire', summary: 'A comprehensive compilation of Roman law that influenced legal systems for centuries.' },
	{ name: 'Byzantine-Sasanian Wars', year: 602, category: 'Byzantine Empire', summary: 'Centuries of conflict between the Byzantine and Persian empires that exhausted both.' },
	{ name: 'Iconoclasm', year: 726, category: 'Byzantine Empire', summary: 'A prolonged Byzantine religious controversy over the veneration of religious images.' },
	{ name: 'Byzantine-Ottoman Wars', year: 1265, category: 'Byzantine Empire', summary: 'A long series of conflicts that gradually eroded Byzantine territory over centuries.' },
	{ name: 'Fall of Constantinople', year: 1453, category: 'Byzantine Empire', summary: 'Ottoman forces capture Constantinople, ending the Byzantine Empire after over a thousand years.' },

	// --- Islamic Golden Age ---
	{ name: 'Muhammad', year: 570, category: 'Islamic Golden Age', summary: 'Founder of Islam, whose teachings are recorded in the Quran.' },
	{ name: 'Hijra', year: 622, category: 'Islamic Golden Age', summary: "Muhammad's migration from Mecca to Medina, marking the start of the Islamic calendar." },
	{ name: 'Rashidun Caliphate', year: 632, category: 'Islamic Golden Age', summary: "The first Islamic caliphate following Muhammad's death, expanding across the Middle East." },
	{ name: 'Umayyad Caliphate', year: 661, category: 'Islamic Golden Age', summary: 'An Islamic dynasty that expanded the caliphate from Spain to Central Asia.' },
	{ name: 'Abbasid Caliphate', year: 750, category: 'Islamic Golden Age', summary: 'A caliphate centered in Baghdad that presided over a golden age of science and culture.' },
	{ name: 'House of Wisdom', year: 762, category: 'Islamic Golden Age', summary: 'A renowned Baghdad institution translating and advancing Greek, Persian, and Indian knowledge.' },
	{ name: 'Al-Khwarizmi', year: 780, category: 'Islamic Golden Age', summary: "Persian mathematician whose work gave rise to the term 'algorithm' and founded algebra." },
	{ name: 'Ibn Sina (Avicenna)', year: 980, category: 'Islamic Golden Age', summary: 'Polymath physician and philosopher whose medical encyclopedia was used in Europe for centuries.' },
	{ name: 'Alhambra', year: 889, category: 'Islamic Golden Age', summary: 'A stunning palace and fortress complex built by Muslim rulers in Granada, Spain.' },
	{ name: 'Saladin', year: 1137, category: 'Islamic Golden Age', summary: 'Sultan who united Muslim territories and recaptured Jerusalem from the Crusaders.' },

	// --- Medieval Europe ---
	{ name: 'Charlemagne', year: 742, category: 'Medieval Europe', summary: 'King of the Franks crowned Holy Roman Emperor, unifying much of Western Europe.' },
	{ name: 'Feudalism', year: 800, category: 'Medieval Europe', summary: 'A hierarchical political and social system organizing medieval European society around land.' },
	{ name: 'Viking Age', year: 793, category: 'Medieval Europe', summary: 'Scandinavian seafarers raid, trade, and settle across Europe for nearly three centuries.' },
	{ name: 'Battle of Hastings', year: 1066, category: 'Medieval Europe', summary: 'William the Conqueror defeats the English king, beginning Norman rule of England.' },
	{ name: 'First Crusade', year: 1096, category: 'Medieval Europe', summary: 'European Christians launch a military campaign to reclaim the Holy Land from Muslim rule.' },
	{ name: 'Magna Carta', year: 1215, category: 'Medieval Europe', summary: 'English barons force King John to accept limits on royal power, a milestone for constitutional law.' },
	{ name: 'Marco Polo', year: 1254, category: 'Medieval Europe', summary: "Venetian merchant whose travels to Asia introduced Europeans to the Mongol court." },
	{ name: 'Black Death', year: 1347, category: 'Medieval Europe', summary: "A devastating plague pandemic kills roughly a third of Europe's population." },
	{ name: "Hundred Years' War", year: 1337, category: 'Medieval Europe', summary: 'A prolonged conflict between England and France over succession and territory.' },
	{ name: 'Joan of Arc', year: 1412, category: 'Medieval Europe', summary: "French peasant girl who led French forces to key victories during the Hundred Years' War." },
	{ name: 'Gothic Cathedrals', year: 1140, category: 'Medieval Europe', summary: 'A soaring architectural style, exemplified by Notre-Dame de Paris, defines church building.' },
	{ name: 'Medieval Guilds', year: 1100, category: 'Medieval Europe', summary: 'Associations of craftsmen and merchants that regulated trade in growing medieval towns.' },

	// --- Mongol Empire ---
	{ name: 'Genghis Khan', year: 1162, category: 'Mongol Empire', summary: 'Founder and first Great Khan of the Mongol Empire, the largest contiguous land empire in history.' },
	{ name: 'Mongol Conquests', year: 1206, category: 'Mongol Empire', summary: 'Mongol armies rapidly conquer territory stretching from China to Eastern Europe.' },
	{ name: 'Pax Mongolica', year: 1279, category: 'Mongol Empire', summary: 'A period of relative stability along Mongol-controlled trade routes, boosting Silk Road commerce.' },
	{ name: 'Kublai Khan', year: 1215, category: 'Mongol Empire', summary: "Genghis Khan's grandson, who completed the conquest of China and founded the Yuan Dynasty." },
	{ name: 'Yuan Dynasty', year: 1271, category: 'Mongol Empire', summary: 'A Mongol-led dynasty ruling China, described by visitor Marco Polo in his travels.' },
	{ name: 'Battle of Baghdad (1258)', year: 1258, category: 'Mongol Empire', summary: "Mongol forces sack Baghdad, ending the Abbasid Caliphate's political power." },

	// --- Pre-Columbian Americas ---
	{ name: 'Olmec Civilization', year: -1200, category: 'Pre-Columbian Americas', summary: "Often called Mesoamerica's 'mother culture', known for colossal carved stone heads." },
	{ name: 'Maya Civilization', year: -2000, category: 'Pre-Columbian Americas', summary: 'A Mesoamerican civilization renowned for its writing system, mathematics, and calendars.' },
	{ name: 'Chichen Itza', year: 600, category: 'Pre-Columbian Americas', summary: 'A major Maya city featuring the iconic step pyramid of Kukulcan.' },
	{ name: 'Teotihuacan', year: -100, category: 'Pre-Columbian Americas', summary: 'A vast pre-Aztec city in central Mexico, home to the massive Pyramid of the Sun.' },
	{ name: 'Aztec Empire', year: 1428, category: 'Pre-Columbian Americas', summary: 'A powerful Mesoamerican empire centered on the island capital of Tenochtitlan.' },
	{ name: 'Tenochtitlan', year: 1325, category: 'Pre-Columbian Americas', summary: 'The Aztec capital built on a lake island, one of the largest cities in the world at its height.' },
	{ name: 'Inca Empire', year: 1438, category: 'Pre-Columbian Americas', summary: "The largest empire in pre-Columbian America, spanning the Andes along South America's coast." },
	{ name: 'Machu Picchu', year: 1450, category: 'Pre-Columbian Americas', summary: 'A remote Inca citadel high in the Andes, rediscovered by the outside world in 1911.' },

	// --- Renaissance ---
	{ name: 'Renaissance Begins', year: 1350, category: 'Renaissance', summary: 'A cultural rebirth in Italy reviving classical learning, art, and humanist thought.' },
	{ name: 'Petrarch', year: 1304, category: 'Renaissance', summary: "Italian scholar and poet often called the 'father of humanism'." },
	{ name: 'Filippo Brunelleschi', year: 1377, category: 'Renaissance', summary: "Architect who engineered the dome of Florence Cathedral, a Renaissance engineering triumph." },
	{ name: 'Gutenberg Printing Press', year: 1440, category: 'Renaissance', summary: "Johannes Gutenberg's movable-type press revolutionizes the spread of written knowledge." },
	{ name: 'Leonardo da Vinci', year: 1452, category: 'Renaissance', summary: 'Renaissance polymath renowned as a painter, inventor, and scientist, creator of the Mona Lisa.' },
	{ name: 'Michelangelo', year: 1475, category: 'Renaissance', summary: 'Sculptor and painter whose works include the Sistine Chapel ceiling and the statue of David.' },
	{ name: 'Raphael', year: 1483, category: 'Renaissance', summary: 'Renaissance master painter celebrated for the harmony and clarity of his compositions.' },
	{ name: 'Niccolò Machiavelli', year: 1469, category: 'Renaissance', summary: 'Political philosopher whose treatise The Prince analyzed the realities of political power.' },
	{ name: 'Protestant Reformation', year: 1517, category: 'Renaissance', summary: "Martin Luther's challenge to Catholic Church practices splits Western Christianity." },
	{ name: 'Martin Luther', year: 1483, category: 'Renaissance', summary: 'German monk whose Ninety-Five Theses sparked the Protestant Reformation.' },
	{ name: 'Sistine Chapel', year: 1508, category: 'Renaissance', summary: "Michelangelo's ceiling frescoes in the Vatican become one of art history's supreme achievements." },
	{ name: 'Medici Family', year: 1434, category: 'Renaissance', summary: 'A powerful Florentine banking family who became major patrons of Renaissance art and culture.' },

	// --- Age of Exploration ---
	{ name: 'Prince Henry the Navigator', year: 1394, category: 'Age of Exploration', summary: 'Portuguese royal who sponsored early voyages down the African coast, launching exploration.' },
	{ name: 'Christopher Columbus', year: 1451, category: 'Age of Exploration', summary: "Genoese explorer whose 1492 voyage opened European contact with the Americas." },
	{ name: 'Vasco da Gama', year: 1460, category: 'Age of Exploration', summary: 'Portuguese explorer who found a sea route from Europe to India around Africa.' },
	{ name: 'Ferdinand Magellan', year: 1480, category: 'Age of Exploration', summary: "Portuguese explorer whose expedition achieved the first circumnavigation of the globe." },
	{ name: 'Columbian Exchange', year: 1492, category: 'Age of Exploration', summary: 'The massive transfer of plants, animals, diseases, and cultures between the Old and New Worlds.' },
	{ name: 'Spanish Conquest of the Aztecs', year: 1519, category: 'Age of Exploration', summary: 'Hernán Cortés and his forces topple the Aztec Empire, aided by disease and local allies.' },
	{ name: 'Spanish Conquest of the Inca', year: 1532, category: 'Age of Exploration', summary: 'Francisco Pizarro captures the Inca emperor, beginning Spanish control of the Andes.' },
	{ name: 'Treaty of Tordesillas', year: 1494, category: 'Age of Exploration', summary: 'Spain and Portugal divide newly discovered lands outside Europe between themselves.' },
	{ name: 'Atlantic Slave Trade', year: 1526, category: 'Age of Exploration', summary: 'European powers begin the forced transport of millions of enslaved Africans to the Americas.' },
	{ name: 'Dutch East India Company', year: 1602, category: 'Age of Exploration', summary: 'One of the first multinational corporations, dominating Asian trade for nearly two centuries.' },

	// --- Scientific Revolution ---
	{ name: 'Nicolaus Copernicus', year: 1473, category: 'Scientific Revolution', summary: 'Astronomer whose heliocentric model placed the Sun, not Earth, at the center of the universe.' },
	{ name: 'Galileo Galilei', year: 1564, category: 'Scientific Revolution', summary: 'Astronomer and physicist whose telescope observations supported the heliocentric model.' },
	{ name: 'Johannes Kepler', year: 1571, category: 'Scientific Revolution', summary: 'Astronomer who discovered that planets move in elliptical orbits around the Sun.' },
	{ name: 'Francis Bacon', year: 1561, category: 'Scientific Revolution', summary: 'Philosopher who formalized the scientific method based on observation and experiment.' },
	{ name: 'William Harvey', year: 1578, category: 'Scientific Revolution', summary: 'Physician who correctly described the circulation of blood pumped by the heart.' },
	{ name: 'René Descartes', year: 1596, category: 'Scientific Revolution', summary: "Philosopher and mathematician whose 'I think, therefore I am' shaped modern philosophy." },
	{ name: 'Isaac Newton', year: 1642, category: 'Scientific Revolution', summary: "Physicist and mathematician whose laws of motion and gravity underpinned classical physics." },
	{ name: "Newton's Principia", year: 1687, category: 'Scientific Revolution', summary: "Newton's landmark work laying out the laws of motion and universal gravitation." },
	{ name: 'Robert Boyle', year: 1627, category: 'Scientific Revolution', summary: 'Chemist often called the father of modern chemistry for his experimental approach to gases.' },
	{ name: 'Royal Society Founded', year: 1660, category: 'Scientific Revolution', summary: "One of the world's oldest scientific institutions, promoting experimental science." },

	// --- Enlightenment ---
	{ name: 'John Locke', year: 1632, category: 'Enlightenment', summary: 'Philosopher whose ideas on natural rights and government by consent influenced modern democracy.' },
	{ name: 'Voltaire', year: 1694, category: 'Enlightenment', summary: 'French writer and philosopher famous for advocating freedom of speech and religious tolerance.' },
	{ name: 'Montesquieu', year: 1689, category: 'Enlightenment', summary: 'Philosopher whose idea of separating government powers shaped modern constitutional design.' },
	{ name: 'Jean-Jacques Rousseau', year: 1712, category: 'Enlightenment', summary: 'Philosopher whose Social Contract argued legitimate authority comes from the will of the people.' },
	{ name: 'Adam Smith', year: 1723, category: 'Enlightenment', summary: "Economist whose Wealth of Nations laid the foundations of modern economic theory." },
	{ name: 'Encyclopédie', year: 1751, category: 'Enlightenment', summary: 'A massive French reference work compiling Enlightenment knowledge, edited by Diderot.' },
	{ name: 'Denis Diderot', year: 1713, category: 'Enlightenment', summary: 'French philosopher and chief editor of the Encyclopédie, a landmark of Enlightenment thought.' },
	{ name: 'Immanuel Kant', year: 1724, category: 'Enlightenment', summary: "German philosopher whose critical philosophy reshaped ethics, metaphysics, and epistemology." },

	// --- Age of Revolutions ---
	{ name: 'American Revolution', year: 1775, category: 'Age of Revolutions', summary: 'Thirteen British colonies in North America fight for and win independence.' },
	{ name: 'Declaration of Independence', year: 1776, category: 'Age of Revolutions', summary: 'The American colonies formally declare independence from Britain, asserting natural rights.' },
	{ name: 'George Washington', year: 1732, category: 'Age of Revolutions', summary: 'Commander of American revolutionary forces and the first President of the United States.' },
	{ name: 'US Constitution', year: 1787, category: 'Age of Revolutions', summary: 'The founding legal document establishing the framework of American government.' },
	{ name: 'French Revolution', year: 1789, category: 'Age of Revolutions', summary: 'A sweeping political upheaval that overthrew the French monarchy and reshaped European politics.' },
	{ name: 'Storming of the Bastille', year: 1789, category: 'Age of Revolutions', summary: 'Parisian revolutionaries seize a royal fortress, a symbolic spark of the French Revolution.' },
	{ name: 'Napoleon Bonaparte', year: 1769, category: 'Age of Revolutions', summary: "French military leader who rose from the Revolution to become emperor and reshape Europe." },
	{ name: 'Napoleonic Wars', year: 1803, category: 'Age of Revolutions', summary: "A series of major conflicts between Napoleon's France and shifting European coalitions." },
	{ name: 'Battle of Waterloo', year: 1815, category: 'Age of Revolutions', summary: "Napoleon's final defeat, ending his rule and reshaping the European political order." },
	{ name: 'Haitian Revolution', year: 1791, category: 'Age of Revolutions', summary: 'An enslaved population successfully revolts, creating the first Black-led republic in the Americas.' },
	{ name: 'Simón Bolívar', year: 1783, category: 'Age of Revolutions', summary: 'South American revolutionary leader who helped liberate several nations from Spanish rule.' },
	{ name: 'Latin American Wars of Independence', year: 1808, category: 'Age of Revolutions', summary: 'A wave of revolutions frees most of Spanish and Portuguese America from colonial rule.' },
	{ name: 'Revolutions of 1848', year: 1848, category: 'Age of Revolutions', summary: 'A wave of political upheavals sweeps across Europe demanding liberal reform.' },
	{ name: 'Mexican War of Independence', year: 1810, category: 'Age of Revolutions', summary: 'An eleven-year struggle ends Spanish colonial rule over Mexico.' },

	// --- Industrial Revolution ---
	{ name: 'Industrial Revolution Begins', year: 1760, category: 'Industrial Revolution', summary: 'New manufacturing processes transform Britain from an agrarian to an industrial economy.' },
	{ name: 'James Watt', year: 1736, category: 'Industrial Revolution', summary: 'Engineer whose improved steam engine powered factories, mines, and eventually railways.' },
	{ name: 'Spinning Jenny', year: 1764, category: 'Industrial Revolution', summary: 'A multi-spindle spinning frame that dramatically increased textile production efficiency.' },
	{ name: 'Steam Locomotive', year: 1804, category: 'Industrial Revolution', summary: "Richard Trevithick's early steam-powered locomotive paves the way for the railway age." },
	{ name: 'First Railways', year: 1825, category: 'Industrial Revolution', summary: "The Stockton and Darlington Railway becomes the world's first public steam railway." },
	{ name: 'Telegraph', year: 1837, category: 'Industrial Revolution', summary: "Samuel Morse's electric telegraph enables near-instant long-distance communication." },
	{ name: 'Charles Darwin', year: 1809, category: 'Industrial Revolution', summary: 'Naturalist whose theory of evolution by natural selection transformed the biological sciences.' },
	{ name: 'On the Origin of Species', year: 1859, category: 'Industrial Revolution', summary: "Darwin's landmark work introduces evolution by natural selection to the world." },
	{ name: 'Karl Marx', year: 1818, category: 'Industrial Revolution', summary: "Philosopher and economist whose critique of capitalism inspired socialist movements." },
	{ name: 'The Communist Manifesto', year: 1848, category: 'Industrial Revolution', summary: "Marx and Engels's pamphlet lays out the theory of class struggle and communism." },

	// --- Imperialism & Colonial Empires ---
	{ name: 'British Raj', year: 1858, category: 'Imperialism & Colonial Empires', summary: 'Direct British Crown rule over the Indian subcontinent following the East India Company era.' },
	{ name: 'Scramble for Africa', year: 1881, category: 'Imperialism & Colonial Empires', summary: 'European powers rapidly colonize almost the entire African continent within a few decades.' },
	{ name: 'Berlin Conference', year: 1884, category: 'Imperialism & Colonial Empires', summary: 'European powers meet to formalize rules for the colonial partition of Africa.' },
	{ name: 'Suez Canal', year: 1869, category: 'Imperialism & Colonial Empires', summary: 'A man-made waterway connecting the Mediterranean and Red Seas, reshaping global trade.' },
	{ name: 'Opium Wars', year: 1839, category: 'Imperialism & Colonial Empires', summary: 'Conflicts between Britain and China that forced China to open to foreign trade.' },
	{ name: 'Meiji Restoration', year: 1868, category: 'Imperialism & Colonial Empires', summary: 'Japan rapidly modernizes and industrializes after centuries of relative isolation.' },
	{ name: 'Boxer Rebellion', year: 1899, category: 'Imperialism & Colonial Empires', summary: 'An anti-foreign, anti-imperialist uprising in China is suppressed by an international coalition.' },
	{ name: 'Spanish-American War', year: 1898, category: 'Imperialism & Colonial Empires', summary: 'A brief war that ends Spanish colonial power and expands US overseas territory.' },
	{ name: 'Panama Canal', year: 1904, category: 'Imperialism & Colonial Empires', summary: 'A transformative engineering project connects the Atlantic and Pacific through Central America.' },
	{ name: 'Cecil Rhodes', year: 1853, category: 'Imperialism & Colonial Empires', summary: 'British imperialist and businessman central to British colonial expansion in southern Africa.' },

	// --- World War I Era ---
	{ name: 'Assassination of Franz Ferdinand', year: 1914, category: 'World War I Era', summary: "The assassination of Austria-Hungary's heir in Sarajevo triggers the outbreak of World War I." },
	{ name: 'World War I Begins', year: 1914, category: 'World War I Era', summary: "A complex web of alliances draws Europe's great powers into a devastating global war." },
	{ name: 'Trench Warfare', year: 1914, category: 'World War I Era', summary: "Static, brutal trench warfare on the Western Front comes to define the war's horror." },
	{ name: 'Battle of the Somme', year: 1916, category: 'World War I Era', summary: 'One of the bloodiest battles in history, with over a million casualties.' },
	{ name: 'Battle of Verdun', year: 1916, category: 'World War I Era', summary: "A grueling, months-long battle that became a symbol of the war's attrition." },
	{ name: 'Russian Revolution', year: 1917, category: 'World War I Era', summary: 'Revolutionary upheaval topples the Russian monarchy and eventually brings the Bolsheviks to power.' },
	{ name: 'Vladimir Lenin', year: 1870, category: 'World War I Era', summary: 'Revolutionary leader who led the Bolsheviks to power and founded the Soviet Union.' },
	{ name: 'United States Enters WWI', year: 1917, category: 'World War I Era', summary: 'American entry into the war shifts the balance decisively toward the Allied powers.' },
	{ name: 'Armistice of 1918', year: 1918, category: 'World War I Era', summary: 'Fighting ends on the Western Front, though formal peace negotiations continue for months.' },
	{ name: 'Treaty of Versailles', year: 1919, category: 'World War I Era', summary: 'The peace treaty ending WWI imposes harsh terms on Germany, sowing seeds of future conflict.' },
	{ name: 'League of Nations', year: 1920, category: 'World War I Era', summary: 'An international organization founded to prevent future wars, a precursor to the United Nations.' },
	{ name: 'Spanish Flu Pandemic', year: 1918, category: 'World War I Era', summary: 'A devastating influenza pandemic kills tens of millions worldwide, compounding wartime suffering.' },
	{ name: 'Ottoman Empire Collapse', year: 1922, category: 'World War I Era', summary: 'Centuries of Ottoman rule end, reshaping the map of the Middle East.' },
	{ name: 'Weimar Republic', year: 1919, category: 'World War I Era', summary: "Germany's fragile post-war democracy struggles with instability, hyperinflation, and extremism." },

	// --- World War II Era ---
	{ name: 'Adolf Hitler', year: 1889, category: 'World War II Era', summary: "Leader of Nazi Germany whose aggressive expansionism and genocidal ideology triggered WWII." },
	{ name: 'Nazi Party Rise', year: 1933, category: 'World War II Era', summary: 'Hitler is appointed German chancellor, rapidly consolidating totalitarian power.' },
	{ name: 'Nuremberg Laws', year: 1935, category: 'World War II Era', summary: 'Nazi Germany enacts sweeping antisemitic legislation stripping Jews of citizenship rights.' },
	{ name: 'Spanish Civil War', year: 1936, category: 'World War II Era', summary: 'A brutal conflict between Republicans and Nationalists becomes a testing ground for WWII tactics.' },
	{ name: 'Invasion of Poland', year: 1939, category: 'World War II Era', summary: "Germany's invasion of Poland triggers the formal start of World War II in Europe." },
	{ name: 'Winston Churchill', year: 1874, category: 'World War II Era', summary: "British Prime Minister whose wartime leadership rallied Britain during its darkest hours." },
	{ name: 'Battle of Britain', year: 1940, category: 'World War II Era', summary: 'The Royal Air Force repels a sustained German bombing campaign, thwarting invasion plans.' },
	{ name: 'Operation Barbarossa', year: 1941, category: 'World War II Era', summary: 'Nazi Germany launches a massive surprise invasion of the Soviet Union.' },
	{ name: 'Pearl Harbor', year: 1941, category: 'World War II Era', summary: 'A surprise Japanese attack on the US naval base brings America into World War II.' },
	{ name: 'Franklin D. Roosevelt', year: 1882, category: 'World War II Era', summary: 'US President who led America through the Great Depression and most of World War II.' },
	{ name: 'The Holocaust', year: 1941, category: 'World War II Era', summary: 'Nazi Germany systematically murders six million Jews and millions of others in genocide.' },
	{ name: 'Battle of Stalingrad', year: 1942, category: 'World War II Era', summary: 'A brutal turning-point battle ends in a decisive Soviet victory over German forces.' },
	{ name: 'D-Day Normandy Landings', year: 1944, category: 'World War II Era', summary: 'Allied forces launch the largest seaborne invasion in history to liberate Western Europe.' },
	{ name: 'Battle of Midway', year: 1942, category: 'World War II Era', summary: "A decisive US naval victory cripples Japan's carrier fleet in the Pacific." },
	{ name: 'Atomic Bombings of Hiroshima and Nagasaki', year: 1945, category: 'World War II Era', summary: 'The US drops atomic bombs on two Japanese cities, hastening the war\'s end.' },
	{ name: 'V-E Day', year: 1945, category: 'World War II Era', summary: "Nazi Germany's unconditional surrender ends the war in Europe." },
	{ name: "Japan's Surrender", year: 1945, category: 'World War II Era', summary: 'Japan formally surrenders, bringing World War II to a close.' },
	{ name: 'United Nations Founded', year: 1945, category: 'World War II Era', summary: 'Nations establish a new international body to promote peace and cooperation after WWII.' },
	{ name: 'Anne Frank', year: 1929, category: 'World War II Era', summary: "Jewish diarist whose account of hiding from Nazi persecution became a symbol of the Holocaust." },
	{ name: 'Nuremberg Trials', year: 1945, category: 'World War II Era', summary: 'Allied powers try senior Nazi officials for war crimes and crimes against humanity.' },

	// --- Cold War Era ---
	{ name: 'Iron Curtain', year: 1946, category: 'Cold War Era', summary: "Winston Churchill's phrase for the ideological divide splitting Europe between East and West." },
	{ name: 'Marshall Plan', year: 1948, category: 'Cold War Era', summary: 'A massive US aid program helps rebuild devastated Western European economies after WWII.' },
	{ name: 'Berlin Blockade', year: 1948, category: 'Cold War Era', summary: 'The Soviet Union blockades West Berlin, prompting a massive Allied airlift of supplies.' },
	{ name: 'NATO Founded', year: 1949, category: 'Cold War Era', summary: 'Western nations form a mutual defense alliance against Soviet expansion.' },
	{ name: 'Chinese Communist Revolution', year: 1949, category: 'Cold War Era', summary: "Mao Zedong's Communist forces win China's civil war, founding the People's Republic." },
	{ name: 'Mao Zedong', year: 1893, category: 'Cold War Era', summary: "Founder of the People's Republic of China and leader of its Communist revolution." },
	{ name: 'Korean War', year: 1950, category: 'Cold War Era', summary: 'A conflict between North and South Korea draws in the US, China, and the USSR.' },
	{ name: 'Space Race Begins', year: 1957, category: 'Cold War Era', summary: 'The Soviet Union launches Sputnik, the first artificial satellite, sparking a space rivalry.' },
	{ name: 'Cuban Missile Crisis', year: 1962, category: 'Cold War Era', summary: 'A tense standoff over Soviet missiles in Cuba brings the world close to nuclear war.' },
	{ name: 'Berlin Wall Built', year: 1961, category: 'Cold War Era', summary: "East Germany builds a wall dividing Berlin, becoming the Cold War's starkest symbol." },
	{ name: 'Vietnam War', year: 1955, category: 'Cold War Era', summary: 'A prolonged and divisive conflict between communist North Vietnam and the US-backed South.' },
	{ name: 'Martin Luther King Jr.', year: 1929, category: 'Cold War Era', summary: "Civil rights leader whose nonviolent activism helped end legal racial segregation in America." },
	{ name: 'Moon Landing', year: 1969, category: 'Cold War Era', summary: "NASA's Apollo 11 mission lands the first humans on the Moon, a Cold War-era triumph." },
	{ name: 'Fall of the Berlin Wall', year: 1989, category: 'Cold War Era', summary: 'East Germans tear down the Berlin Wall, symbolizing the collapse of communist rule in Europe.' },
	{ name: 'Mikhail Gorbachev', year: 1931, category: 'Cold War Era', summary: 'Soviet leader whose reforms of glasnost and perestroika hastened the USSR\'s collapse.' },
	{ name: 'Dissolution of the Soviet Union', year: 1991, category: 'Cold War Era', summary: 'The USSR formally dissolves into fifteen independent states, ending the Cold War.' },

	// --- Contemporary Era ---
	{ name: 'World Wide Web', year: 1989, category: 'Contemporary Era', summary: 'Tim Berners-Lee invents the Web, transforming how humanity accesses and shares information.' },
	{ name: 'Nelson Mandela', year: 1918, category: 'Contemporary Era', summary: "Anti-apartheid leader who became South Africa's first Black president after 27 years in prison." },
	{ name: 'End of Apartheid', year: 1994, category: 'Contemporary Era', summary: "South Africa holds its first fully democratic elections, ending decades of racial segregation." },
	{ name: 'European Union Formed', year: 1993, category: 'Contemporary Era', summary: 'The Maastricht Treaty formally establishes the European Union, deepening European integration.' },
	{ name: 'September 11 Attacks', year: 2001, category: 'Contemporary Era', summary: 'Coordinated terrorist attacks on the United States reshape global security and foreign policy.' },
	{ name: 'Human Genome Project', year: 2003, category: 'Contemporary Era', summary: "An international effort successfully maps the complete human genetic code." },
	{ name: 'Global Financial Crisis', year: 2008, category: 'Contemporary Era', summary: 'A severe worldwide economic crisis triggers recessions and lasting policy changes.' },
	{ name: 'Smartphone Revolution', year: 2007, category: 'Contemporary Era', summary: 'The launch of the iPhone accelerates a global shift toward mobile computing and connectivity.' },
	{ name: 'Arab Spring', year: 2010, category: 'Contemporary Era', summary: 'A wave of pro-democracy protests and uprisings sweeps across the Arab world.' },
	{ name: 'Paris Climate Agreement', year: 2015, category: 'Contemporary Era', summary: 'Nearly every nation commits to limiting global greenhouse gas emissions and warming.' },
	{ name: 'COVID-19 Pandemic', year: 2020, category: 'Contemporary Era', summary: 'A novel coronavirus triggers a global pandemic, reshaping public health, work, and daily life.' },
	{ name: 'Rise of Artificial Intelligence', year: 2022, category: 'Contemporary Era', summary: 'Advances in machine learning bring AI systems into mainstream use across industries.' },
];

// Hand-picked cross-era connections, on top of the hub-and-spoke + hub-chain
// structure above - these are what give Find-path's hub-avoidance cost
// model an actual *choice* to make (a short, specific link vs. the longer
// hub-routed path), not just a single obvious route.
const EXTRA_LINKS = [
	['Julius Caesar', 'Cleopatra VII'],
	['Cleopatra and Mark Antony', 'Cleopatra VII'],
	['Alexander the Great', 'Aristotle'],
	['Alexander the Great', 'Persian Empire'],
	['Fall of Constantinople', 'Renaissance Begins'],
	['Galileo Galilei', 'Renaissance Begins'],
	['Marco Polo', 'Silk Road'],
	['Marco Polo', 'Yuan Dynasty'],
	['Genghis Khan', 'Silk Road'],
	['Treaty of Versailles', 'Adolf Hitler'],
	['Karl Marx', 'Russian Revolution'],
	['Karl Marx', 'Chinese Communist Revolution'],
	['Napoleon Bonaparte', 'French Revolution'],
	['Christopher Columbus', 'Atlantic Slave Trade'],
	['Martin Luther King Jr.', 'Nelson Mandela'],
	['Dissolution of the Soviet Union', 'European Union Formed'],
	['Nuremberg Trials', 'United Nations Founded'],
	['Muhammad', 'Byzantine-Sasanian Wars'],
	['Saladin', 'First Crusade'],
	['Ottoman Empire Collapse', 'Fall of Constantinople'],
	['Isaac Newton', 'Royal Society Founded'],
	['Charles Darwin', 'Adam Smith'],
	['World Wide Web', 'Smartphone Revolution'],
	['Mao Zedong', 'Chinese Communist Revolution'],
	['Vladimir Lenin', 'Karl Marx'],
];

const PERIOD_FOLDER = {
	Ancient: '1-Ancient',
	Medieval: '2-Medieval',
	'Early Modern': '3-Early-Modern',
	Modern: '4-Modern',
	Contemporary: '5-Contemporary',
};

const categoryByName = new Map(CATEGORIES.map((c) => [c.name, c]));

// Every entry links back to its own era hub; every era hub links to every
// entry in it, plus the next hub in HUB_CHAIN - see HUB_CHAIN's own comment
// for why a chain, not just isolated hub-and-spoke clusters.
const linksByName = new Map();
function addLink(a, b) {
	if (!linksByName.has(a)) linksByName.set(a, new Set());
	if (!linksByName.has(b)) linksByName.set(b, new Set());
	linksByName.get(a).add(b);
	linksByName.get(b).add(a);
}

for (const entry of ENTRIES) addLink(entry.name, entry.category);
for (let i = 0; i < HUB_CHAIN.length - 1; i++) addLink(HUB_CHAIN[i], HUB_CHAIN[i + 1]);
for (const [a, b] of EXTRA_LINKS) addLink(a, b);

// Compresses real history's ~5,000-year span (from the start of writing,
// -3000, to today) onto a 0-720 day mtime backdate - everything before
// -3000 (a handful of Prehistory entries) floors out at the oldest bucket
// rather than dragging the whole scale toward one extreme outlier. A tiny
// per-entry, index-derived jitter (hours, not days) keeps same-day entries
// from sharing one identical mtime, so Timeline's "steps" pace mode has
// something to actually step through even within one compressed day.
const MIN_YEAR = -3000;
const MAX_YEAR = 2024;
const MAX_AGE_DAYS = 720;
function mtimeFor(year, index) {
	const clamped = Math.max(MIN_YEAR, Math.min(MAX_YEAR, year));
	const frac = (MAX_YEAR - clamped) / (MAX_YEAR - MIN_YEAR);
	const ageDays = Math.max(0, Math.round(frac * MAX_AGE_DAYS));
	const jitterMs = (index % 24) * 60 * 60 * 1000;
	return new Date(now - ageDays * DAY - jitterMs);
}

function yearLabel(year) {
	return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function writeNote(relFolder, name, body, mtime) {
	const filePath = join(ROOT, FOLDER, relFolder, `${name}.md`);
	mkdirSync(join(ROOT, FOLDER, relFolder), { recursive: true });
	writeFileSync(filePath, body);
	if (mtime) utimesSync(filePath, mtime, mtime);
}

let index = 0;
let written = 0;

// Era/civilization hub notes.
for (const category of CATEGORIES) {
	const links = [...(linksByName.get(category.name) ?? [])];
	const frontmatter = `---\nregion: ${category.region}\nperiod: ${category.period}\n---\n\n`;
	const body = [frontmatter, `# ${category.name}\n\n`, `${category.blurb}\n\n`, links.length ? `## Links\n\n${links.map((l) => `[[${l}]]`).join(' ')}\n` : ''].join('');
	writeNote(PERIOD_FOLDER[category.period], category.name, body, mtimeFor(0, index));
	index++;
	written++;
}

// Individual entries.
for (const entry of ENTRIES) {
	const category = categoryByName.get(entry.category);
	const links = [...(linksByName.get(entry.name) ?? [])];
	const frontmatterLines = [`era: ${entry.category}`, `region: ${category.region}`, `period: ${category.period}`, `year: ${entry.year}`];
	if (entry.cover) frontmatterLines.push('cover: attachments/cover.svg');
	const frontmatter = `---\n${frontmatterLines.join('\n')}\n---\n\n`;
	const body = [
		frontmatter,
		`# ${entry.name}\n\n`,
		`*${yearLabel(entry.year)}*\n\n`,
		`${entry.summary}\n\n`,
		links.length ? `## Links\n\n${links.map((l) => `[[${l}]]`).join(' ')}\n` : '',
	].join('');
	writeNote(PERIOD_FOLDER[category.period], entry.name, body, mtimeFor(entry.year, index));
	index++;
	written++;
}

console.log(`Wrote ${written} notes (${CATEGORIES.length} era hubs + ${ENTRIES.length} entries) to ${ROOT}/${FOLDER}/`);
console.log('Open as an Obsidian vault, symlink the plugin (see DEVELOPMENT.md), then use the ribbon icon or "Open graph" command.');
console.log('This vault is for screenshots/visual demos only - see gen-test-vault.mjs for the functional QA vault DEVELOPMENT.md checks against.');
