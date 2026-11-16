import { encodeCustom } from "./finish";

/** A preset key or a custom finish string (lib/finish.ts). */
export type Finish = string;
export { encodeCustom };

/** One contract for both the LLM and the local fallback. */
export interface Intent {
  language: string; // ISO 639-1
  finish?: Finish;
  material: boolean;
  split: boolean;
  regenerate: boolean;
  explode?: boolean;
  reply: string;
  source: "llm" | "local";
}

// ---------- language detection ----------
export function detectLanguage(t: string): string {
  if (/[぀-ヿ]/.test(t)) return "ja";
  if (/[가-힯]/.test(t)) return "ko";
  if (/[一-鿿]/.test(t)) return "zh";
  if (/[؀-ۿ]/.test(t)) return "ar";
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[Ѐ-ӿ]/.test(t)) return "ru";
  if (/[Ͱ-Ͽ]/.test(t)) return "el";
  if (/[֐-׿]/.test(t)) return "he";
  if (/[฀-๿]/.test(t)) return "th";
  const s = ` ${t.toLowerCase()} `;
  const score = (words: string[]) => words.reduce((n, w) => n + (s.includes(` ${w} `) ? 1 : 0), 0);
  const cands: [string, number][] = [
    ["es", score(["el", "la", "los", "las", "con", "una", "un", "y", "de", "hazlo", "quiero", "que", "para", "por"]) + (/[¿¡ñ]/.test(s) ? 2 : 0)],
    ["fr", score(["le", "les", "des", "une", "avec", "et", "pour", "en", "rends", "mets", "je", "veux"]) + (/[çœ]|\bà\b/.test(s) ? 1 : 0)],
    ["de", score(["der", "die", "das", "und", "mit", "ein", "eine", "ich", "mach", "bitte", "nicht", "sie"]) + (/[ß]/.test(s) ? 2 : 0)],
    ["pt", score(["o", "os", "uma", "com", "e", "para", "que", "quero", "deixe", "faça"]) + (/[ãõ]/.test(s) ? 2 : 0)],
    ["it", score(["il", "lo", "gli", "una", "con", "e", "per", "voglio", "rendi", "fai"])],
    ["nl", score(["de", "het", "een", "met", "en", "voor", "ik", "maak", "wil"])],
    ["tr", score(["bir", "ve", "ile", "için", "yap", "istiyorum"]) + (/[ğışİ]/.test(s) ? 2 : 0)],
  ];
  const HINTS: Record<string, RegExp> = {
    es: /\b(hazlo|haz|quiero|dorado|dorada|separa|separar|componentes|azul|negro|plata|otra vez|de nuevo)\b/,
    fr: /\b(rends|rendez|mets|doré|dorée|sépare|séparer|composants|bleu|noir|argent|je veux|encore)\b/,
    de: /\b(mach|mache|golden|trenne|trennen|komponenten|blau|schwarz|silber|bitte|noch einmal)\b/,
    pt: /\b(deixe|dourado|dourada|separe|separar|componentes|azul|preto|prata|quero|novamente)\b/,
    it: /\b(rendilo|dorato|dorata|separa|componenti|blu|nero|argento|voglio|ancora)\b/,
    nl: /\b(maak|goud|gouden|splits|onderdelen|blauw|zwart|zilver|opnieuw)\b/,
    tr: /\b(yap|altın|ayır|parçalara|mavi|siyah|gümüş|yeniden)\b/,
  };
  for (const c of cands) if (HINTS[c[0]]?.test(s)) c[1] += 2;
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] >= 2 ? cands[0][0] : "en";
}

export function languageName(code: string): string {
  try { return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code; } catch { return code; }
}

// ---------- multilingual lexicon (fallback when no LLM key) ----------
const L = (s: string) => new RegExp(s, "iu");
// Preset finishes in the lexicon languages. The AI (when a key is set) handles any other finish.
const FINISH_WORDS: Record<string, RegExp> = {
  desert: L("gold|golden|champagne|dorad|dor[ée]e?\\b|dourad|\\boro\\b|dorato|goud|золот|金色|金|ゴールド|골드|금색|ذهب|ذهبي|सोन|altın|χρυσ"),
  midnight: L("blue|navy|midnight|azul|bleu|blau|\\bblu\\b|blauw|син|蓝|青|ブルー|青い|파란|블루|파랑|أزرق|नीला|mavi|μπλε"),
  graphite: L("black|graphite|grafito|grafite|noir|schwarz|negro|preto|nero|zwart|чёрн|черн|графит|黑|黒|ブラック|검정|검은|블랙|أسود|काला|siyah|μαύρ"),
  titanium: L("titanium|titanio|titane|titan\\b|钛|チタン|티타늄|титан|silver|plata|argent|silber|prata|argento|zilver|серебр|银|銀|シルバー|은색|فضي|चांदी|gümüş"),
  white: L("white|blanc|blanco|blanca|weiß|weiss|branco|bianco|wit\\b|бел|白|ホワイト|흰|화이트|أبيض|सफ़ेद|सफेद|beyaz"),
  red: L("\\bred\\b|rojo|roja|rouge|\\brot\\b|vermelh|rosso|rossa|\\brood\\b|красн|红|赤|レッド|빨간|빨강|레드|أحمر|लाल|kırmızı"),
  green: L("green|verde|\\bvert\\b|verte|grün|grun\\b|groen|зелён|зелен|绿|緑|グリーン|초록|녹색|أخضر|हरा|yeşil"),
  bronze: L("bronze|bronce|бронз|青铜|ブロンズ|브론즈|برونز|कांस्य|bronz"),
  copper: L("copper|cobre|cuivre|kupfer|rame\\b|koper|медн|铜|銅|カッパー|구리|نحاس|तांबा|bakır"),
  walnut: L("walnut|nogal|noyer|nussbaum|nogueira|noce\\b|walnoot|орех|胡桃|ウォールナット|월넛|جوز|अखरोट|ceviz"),
  oak: L("\\boak\\b|wood|wooden|roble|madera|chêne|chene|bois|eiche|holz|carvalho|madeira|rovere|legno|eik\\b|hout|дуб|дерев|橡木|木|オーク|木製|오크|나무|خشب|बलूत|लकड़ी|meşe|ahşap"),
  marble: L("marble|mármol|marmol|marbre|marmor|mármore|marmo|marmer|мрамор|大理石|マーブル|대리석|رخام|संगमरमर|mermer"),
  concrete: L("concrete|hormigón|hormigon|béton|beton|concreto|calcestruzzo|бетон|混凝土|コンクリート|콘크리트|خرسانة|कंक्रीट"),
  linen: L("linen|fabric|lino|\\blin\\b|leinen|tecido|tessuto|linnen|лён|льн|ткан|亚麻|布|リネン|린넨|كتان|लिनन|keten|kumaş"),
};
const SPLIT_WORDS = L("split|separate|components?|parts?\\b|disassembl|explode|separar|componentes|piezas|partes|s[ée]parer|composants|pi[èe]ces|trennen|komponenten|teile|dividere|separare|componenti|scheiden|onderdelen|разд|компонент|част|拆|分离|分開|分离|部件|零件|分割|分解|部品|분리|부품|분해|فصل|مكونات|أجزاء|अलग|घटक|ayır|bileşen|parça");
const MATERIAL_WORDS = L("finish|material|colou?r|paint|texture|acabado|material|color|couleur|finition|farbe|oberfl|cor\\b|acabamento|colore|finitura|kleur|цвет|отделк|颜色|颜色|材质|涂|色|仕上げ|マテリアル|마감|색|لون|تشطيب|रंग|फिनिश|renk|kaplama");
const REGEN_WORDS = L("regenerat|redo|again|from scratch|otra vez|de nuevo|regenerar|r[ée]g[ée]n[ée]r|recommenc|neu erstellen|noch einmal|de novo|novamente|rigenera|opnieuw|заново|снова|重新|再生成|もう一度|다시|أعد|फिर से|yeniden");
const EXPLODE_ON = L("explode|disassembl|exploded|despiece|explosionn|explosionsansicht|分解|爆炸|展開|분해|разобр|تفكيك|खोल");
const ASSEMBLE = L("assemble|put back|reassembl|ensambl|remonter|zusammen|montar|montare|собер|组装|組み立て|조립|تجميع|जोड़");

const REPLIES: Record<string, { ok: string; unclear: string }> = {
  en: { ok: "On it — updating your model.", unclear: "I couldn't find a change to make. Try \"make it walnut\" or \"split the parts\"." },
  es: { ok: "Entendido, actualizo tu modelo.", unclear: "No encontré un cambio que hacer. Prueba \"hazlo dorado\" o \"separa los componentes\"." },
  fr: { ok: "C'est parti, je mets à jour votre modèle.", unclear: "Je n'ai pas trouvé de modification. Essayez « rends-le doré » ou « sépare les composants »." },
  de: { ok: "Alles klar, ich aktualisiere dein Modell.", unclear: "Ich habe keine Änderung erkannt. Versuche \"mach es golden\" oder \"trenne die Komponenten\"." },
  pt: { ok: "Certo, estou atualizando seu modelo.", unclear: "Não encontrei uma alteração. Tente \"deixe dourado\" ou \"separe os componentes\"." },
  it: { ok: "Va bene, aggiorno il tuo modello.", unclear: "Non ho trovato modifiche. Prova \"rendilo dorato\" o \"separa i componenti\"." },
  nl: { ok: "Komt eraan, ik pas je model aan.", unclear: "Ik vond geen wijziging. Probeer \"maak het goud\" of \"splits de onderdelen\"." },
  tr: { ok: "Tamam, modelini güncelliyorum.", unclear: "Bir değişiklik bulamadım. \"Altın yap\" veya \"parçalara ayır\" deneyin." },
  ru: { ok: "Принято, обновляю модель.", unclear: "Не нашёл, что изменить. Попробуйте «сделай золотым» или «раздели на компоненты»." },
  zh: { ok: "好的，正在更新你的模型。", unclear: "没有找到要修改的内容。可以试试“改成金色”或“拆分组件”。" },
  ja: { ok: "了解しました。モデルを更新します。", unclear: "変更内容が見つかりませんでした。「ゴールドにして」「部品を分割して」などをお試しください。" },
  ko: { ok: "알겠습니다. 모델을 업데이트합니다.", unclear: "변경할 내용을 찾지 못했어요. \"골드로 바꿔줘\" 또는 \"부품 분리\"를 시도해 보세요." },
  ar: { ok: "حسنًا، أقوم بتحديث النموذج.", unclear: "لم أجد تغييرًا لتنفيذه. جرّب «اجعله ذهبيًا» أو «افصل المكونات»." },
  hi: { ok: "ठीक है, मैं आपका मॉडल अपडेट कर रहा हूँ।", unclear: "कोई बदलाव नहीं मिला। \"इसे सुनहरा करें\" या \"हिस्सों को अलग करें\" आज़माएँ।" },
};

export function replyFor(lang: string, ok: boolean): string {
  return (REPLIES[lang] ?? REPLIES.en)[ok ? "ok" : "unclear"];
}

/** "?" in Latin, Spanish, CJK and Arabic punctuation. */
const QUESTION = /[?？؟]\s*$|^\s*¿/;

export function localInterpret(message: string): Intent {
  const language = detectLanguage(message);
  if (QUESTION.test(message)) {
    // Without the AI the lexicon can't answer questions; don't mistake "what did the split do?" for a split request.
    const reply = language === "en"
      ? "I can only answer questions when the AI is available (GEMINI_API_KEY). I can still make changes: try \"make it walnut\" or \"split the parts\"."
      : replyFor(language, false);
    return { language, material: false, split: false, regenerate: false, reply, source: "local" };
  }
  let finish: Finish | undefined;
  let best = Infinity;
  for (const [f, re] of Object.entries(FINISH_WORDS)) {
    const m = re.exec(message);
    if (m && m.index < best) { best = m.index; finish = f; }
  }
  const split = SPLIT_WORDS.test(message);
  const material = MATERIAL_WORDS.test(message) || !!finish;
  const regenerate = REGEN_WORDS.test(message);
  let explode: boolean | undefined;
  if (ASSEMBLE.test(message)) explode = false;
  else if (EXPLODE_ON.test(message)) explode = true;
  const actionable = !!finish || split || regenerate || explode !== undefined || material;
  return { language, finish, material, split, regenerate, explode, reply: replyFor(language, actionable), source: "local" };
}

