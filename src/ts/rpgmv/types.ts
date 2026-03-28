// ═══════════════════════════════════════════
// RPG Maker MV/MZ Data Structure Type Definitions
// ═══════════════════════════════════════════

// ── RPG Maker Event Commands ──

/** RPG Maker event command (the atomic unit of event scripting) */
export interface EventCommand {
    code: number;
    indent: number;
    parameters: (string | number | boolean | null | any[])[];
}

/** RPG Maker event page (one page within a map event or common event) */
export interface EventPage {
    conditions: Record<string, any>;
    list: EventCommand[];
    note?: string;
}

// ── RPG Maker Map Data ──

/** A single event placed on a map */
export interface MapEvent {
    id: number;
    name: string;
    note?: string;
    pages: EventPage[];
}

/** RPG Maker map JSON structure (Map###.json) */
export interface MapData {
    displayName?: string;
    note?: string;
    events: (MapEvent | null)[];
    autoplayBgm?: boolean;
    [key: string]: any;
}

// ── RPG Maker Database Items ──

/** Actors.json entry */
export interface ActorData {
    id: number;
    name: string;
    nickname?: string;
    profile?: string;
    note?: string;
    [key: string]: any;
}

/** Classes.json entry */
export interface ClassData {
    id: number;
    name: string;
    learnings?: { name?: string;[key: string]: any };
    note?: string;
    [key: string]: any;
}

/** Skills.json entry */
export interface SkillData {
    id: number;
    name: string;
    description?: string;
    message1?: string;
    message2?: string;
    note?: string;
    [key: string]: any;
}

/** States.json entry */
export interface StateData {
    id: number;
    name: string;
    description?: string;
    message1?: string;
    message2?: string;
    message3?: string;
    message4?: string;
    note?: string;
    [key: string]: any;
}

/** Items.json / Weapons.json / Armors.json entry */
export interface ItemData {
    id: number;
    name: string;
    description?: string;
    note?: string;
    [key: string]: any;
}

/** Enemies.json entry */
export interface EnemyData {
    id: number;
    name: string;
    note?: string;
    [key: string]: any;
}

/** Troops.json entry (contains event pages like map events) */
export interface TroopData {
    id: number;
    name: string;
    pages: EventPage[];
    [key: string]: any;
}

/** CommonEvents.json entry */
export interface CommonEventData {
    id: number;
    name: string;
    list: EventCommand[];
    [key: string]: any;
}

// ── System.json ──

export interface SystemTerms {
    basic: string[];
    commands: (string | null)[];
    params: string[];
    messages: Record<string, string>;
}

export interface SystemData {
    armorTypes: string[];
    currencyUnit: string;
    elements: string[];
    equipTypes: string[];
    gameTitle: string;
    skillTypes: string[];
    terms: SystemTerms;
    weaponTypes: string[];
    hasEncryptedImages?: boolean;
    hasEncryptedAudio?: boolean;
    encryptionKey?: string;
    [key: string]: any;
}

// ── Plugin Data ──

export interface PluginData {
    name: string;
    status: boolean;
    description: string;
    parameters: Record<string, string>;
    [key: string]: any;
}

// ── Extraction Pipeline Types ──

/** Configuration for extraction, built in extractHandler and passed to extract() */
export interface ExtractConf {
    extended: boolean;
    fileName: string;
    dir: string;
    srce?: boolean;
    autoline?: boolean;
    note?: boolean;
    arg: ExtractArg;
}

/** Arguments from renderer to main process for extraction */
export interface ExtractArg {
    dir: string;
    force?: boolean;
    silent?: boolean;
    ext_src?: boolean;
    ext_note?: boolean;
    ext_plugin?: boolean;
    ext_javascript?: boolean;
    exJson?: boolean;
    autoline?: boolean;
    decryptImg?: boolean;
    decryptAudio?: boolean;
    [key: string]: any;
}

/** File type identifiers used by the extraction pipeline */
export type ExtractFileType =
    | 'map'
    | 'sys'
    | 'actor'
    | 'class'
    | 'skill'
    | 'state'
    | 'ene'
    | 'ene2'
    | 'item'
    | 'events'
    | 'plugin'
    | 'ex';

/** Internal dictionary entry during extraction (values in dat_obj.main) */
export interface ExtractDictEntry {
    var: string;
    conf?: ExtractEntryConf;
    qpath: string;
}

/** Per-entry extraction config metadata stored alongside extracted text */
export interface ExtractEntryConf {
    type?: string;
    code?: number;
    eid?: number;
    face?: boolean;
    isComment?: boolean;
    comment?: string;
}

// ── .extracteddata Metadata ──

/** A single entry in the .extracteddata file, keyed by line number */
export interface ExtractedDataEntry {
    val: string;         // dotted JSON path into the original data
    m: number;           // exclusive end line number — text spans lines [lineNumber, m)
    origin?: string;     // source JSON filename
    type?: string;       // entry type marker (legacy files may omit this)
    conf?: ExtractEntryConf;
    originText?: string; // original text at extraction time
}

/** Per-file data block inside .extracteddata */
export interface ExtractedFileData {
    data: Record<string, ExtractedDataEntry>;
    isbom?: boolean;
    outputText?: string;
}

/** Top-level structure of .extracteddata (after decompression) */
export interface ExtractedData {
    main: Record<string, ExtractedFileData>;
}

// ── Apply Pipeline Types ──

/** Arguments from renderer for apply operation */
export interface ApplyArg {
    dir: string;
    instantapply?: boolean;
    autoline?: boolean;
    isComment?: boolean;
    useYaml?: boolean;
    [key: string]: any;
}

// ── onebyone mapping type ──

/** Maps JSON filenames to their extraction file type */
export type OneByOneMap = Record<string, ExtractFileType>;
