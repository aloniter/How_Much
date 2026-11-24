// English / Hebrew strings. Each phone picks its own language; Hebrew switches the layout to right-to-left.

const en = {
  dir: 'ltr',
  langName: 'English',
  switchTo: '🇮🇱 עברית',
  switchAria: 'Switch to Hebrew',
  tagline: 'Guess the check. Checkmate the family. ♛',
  startTable: '🍽️ Start a new table',
  codePh: 'CODE',
  codeAria: 'Table code',
  join: 'Join',
  howItWorks: 'How it works',
  how1: 'Everyone joins with the code or QR',
  how2: 'Each person secretly guesses the total',
  how3: 'Reveal the receipt & see who nailed it',
  recentTables: 'Your recent tables',
  footerHome: '♛ CheckMate · made for loud family dinners 🍷',
  codeLen: 'Codes have 4 letters',
  backArrow: '←',
  back: 'Back',
  backHome: '← Back home',
  home: 'Home',

  newTable: 'New dinner table',
  yourName: 'Your name',
  namePhHost: 'e.g. Dad',
  yourAvatar: 'Your avatar',
  pickAvatarAria: 'Pick your food avatar',
  whereEating: 'Where are we eating?',
  titlePh: 'Family dinner at Grandma’s',
  currency: 'Currency',
  rules: 'Rules',
  modeClassic: '🎯 Closest wins',
  modeNover: '💥 Don’t go over',
  modeClassicDesc: 'Whoever is closest to the real bill wins — over or under.',
  modeNoverDesc: 'Closest guess WITHOUT going over the real bill wins. Guess too high = busted!',
  openTable: 'Open the table 🚪',
  defaultTitle: 'Family dinner',
  firstRound: 'Dinner',

  dinnerTable: 'Dinner table',
  tableInfo: 'Table {code} · {n} at the table',
  pickAvatar: 'Pick your avatar',
  namePhJoin: 'e.g. Grandma',
  sitDown: 'Sit down 🪑',
  rejoinHint: 'Already joined on another phone? Use the same name to take your seat back.',
  welcomeBack: 'Welcome back! 👋',

  connecting: 'Connecting to the table… 🍽️',
  roundN: 'Round {n}',
  settingsLink: '⚙️ Table settings',
  profileLink: '✏️ Change my name/avatar',
  shareAria: 'Share the table code',
  mute: 'Mute',
  unmute: 'Unmute',

  whatTotal: 'What’s the total bill? 🤔',
  guessAria: 'Your guess for the total bill',
  trashTalk: 'Trash talk (optional) 😈',
  trash: ['Easy money 😎', 'I saw the menu prices 👀', 'Trust me, I’m an accountant', 'Pure instinct', 'Whoever loses pays 😈', 'Wine was NOT cheap', 'I always win this'],
  lockIn: 'Lock it in 🔒',
  updateGuess: 'Update my guess ✏️',
  keep: 'Keep {amount}',
  secretHint: 'Nobody sees your number until the reveal. Speed counts for the ⚡ award!',
  lockedAfter: '✅ Locked in after {t}',
  changeMind: 'Change my mind 🔄',
  atTable: 'At the table',
  guessedCount: '{done}/{total} guessed',
  waitingFor: 'Waiting for {names}… 👀',
  inviteFamily: '📲 Invite the family',
  thinking: 'thinking…',
  inTime: '✓ in {t}',
  online: 'online',
  offline: 'offline',
  removeX: 'Remove {name}',
  gotReceipt: '🧾 Got the receipt?',
  receiptHint: 'Whoever holds the bill types the real total. Everyone’s phone will do the big reveal together.',
  realTotalPh: 'Real total',
  realTotalAria: 'Real total from the receipt',
  reveal: 'Reveal 🥁',
  confirmMissing: (v) => `${v.names} ${v.count === 1 ? 'hasn’t' : 'haven’t'} guessed yet. Reveal anyway?`,
  typeNumber: 'Type a number first 🙂',
  typeReal: 'Type the real total from the receipt',
  kickConfirm: 'Remove {name} from the table?',

  realBillIs: 'The real bill is…',
  skip: 'Skip ⏭',
  theRealBillOverlay: '🧾 The real bill',
  checkmateWins: '♛ Checkmate! {who} wins',
  thatsYou: 'That’s YOU! 🎉',
  youWere: 'You were #{rank} · {verdict}',

  theRealBill: 'The real bill',
  revealedBy: 'revealed by {who}',
  youLine: 'You: {amount} · #{rank} of {n} · {verdict}',
  didntGuess: 'You didn’t guess this round 🙊',
  average: 'Average',
  median: 'Median',
  range: 'Range',
  podium: '🏆 The podium',
  crowdTitle: '🧠 Wisdom of the crowd',
  crowdOne: 'Only one guess this round — the crowd needs more people! 👥',
  crowdHow: ['scary close 😳', 'pretty close 👍', 'a bit off 🤷', 'way off 🙈'],
  crowdMain: (v) => `The group average (${v.avg}) was ${v.pct} ${v.over ? 'over' : 'under'} — ${v.how}. `,
  crowdAll: 'It beat everyone individually. Together you’re smarter! 🧠',
  crowdNone: 'But every single person beat the average. Individually brilliant! ✨',
  crowdSome: 'It beat {beat} of {n} people. ',
  crowdMostOver: 'Most of you guessed too high — feeling rich? 💸',
  crowdMostUnder: 'Most of you guessed too low — this place is pricier than you think 🧾',
  crowdSplit: 'Perfectly split between over and under ⚖️',
  whereLanded: '📍 Where everyone landed',
  legendReal: 'Real bill',
  legendAvg: 'Group average',
  tapFace: 'Tap a face for details',
  howFar: '🎯 How far off?',
  legendLow: 'Guessed too low',
  legendHigh: 'Guessed too high',
  speedRace: '⚡ The speed race',
  awardsNight: '🎖️ Awards night',
  fullResults: '📋 Full results',
  colWho: 'Who',
  colGuess: 'Guess',
  colOff: 'Off',
  exact: 'exact!',
  pointsRule: 'Points: 🥇 5 · 🥈 3 · 🥉 2 · everyone else 1 · 🎯 bullseye (within 1%) +3',
  pointsRuleBust: ' · 💥 busted 0',
  overall: '👑 Overall leaderboard',
  split: '💳 Split the bill',
  tip: 'Tip',
  tipAria: 'Tip percent',
  peoplePaying: 'People paying',
  fewer: 'Fewer people',
  more: 'More people',
  eachPays: 'Each person pays',
  totalWithTip: 'Total with tip {x}',
  funRule: '😈 Fun rule: {who} (farthest off) buys dessert!',
  shareResults: '📤 Share the results',
  playAgain: 'Play again?',
  playAgainHint: 'Starts a new round at this table — points keep adding up on the leaderboard.',
  nextIdeas: ['Dessert 🍰', 'Drinks 🍷', 'Tip 💁', 'Next dinner 🍽️', 'Coffee ☕'],

  inviteTitle: 'Invite the table 📲',
  scanHint: 'Scan with the phone camera, or enter the code',
  copyLink: '📋 Copy link',
  send: '📤 Send…',
  done: 'Done',
  copied: 'Copied! 📋',
  copyFailed: 'Copy failed — long-press to copy',
  inviteText: 'Join our CheckMate table! Guess the dinner bill 🍽️ Code: {code}',
  profileTitle: 'You',
  name: 'Name',
  save: 'Save',
  cancel: 'Cancel',
  saved: 'Saved ✅',
  settingsTitle: '⚙️ Table settings',
  tableName: 'Table name',
  roundCalled: 'This round is called',

  newRound: 'New round: {label}',
  satDown: '{who} sat down at the table',
  tableClosed: 'That dinner table has closed 🍽️',
  removed: 'You were removed from the table',
  shareHeader: '♛ CheckMate — {title} ({label})',
  shareLine: 'Real bill: {real} · Group average: {avg} ({pct})',
  shareTitle: 'CheckMate results',

  verdicts: {
    calc: 'Human calculator', eagle: 'Eagle eye', sharp: 'Pretty sharp', notbad: 'Not bad at all',
    drinks: 'Forgot about the drinks', champagne: 'Ordered imaginary champagne',
    prices2015: 'Living on 2015 prices', lobster: 'Thinks we ate lobster',
    neverPaid: 'Has never paid a bill', buyRestaurant: 'Wants to buy the restaurant',
  },
  awards: {
    closest: 'Closest guess', farthest: 'Farthest off', fastest: 'Fastest finger', slowest: 'Still reading the menu',
    bigspender: 'Big spender', cheapskate: 'Cheapskate', flipflop: 'Flip-flopper', average: 'Most average person',
    bullseye: 'Bullseye!', busted: 'Busted',
  },
  details: {
    over: 'over by {p}', under: 'under by {p}', exact: 'EXACTLY right 🤯', answeredIn: 'answered in {t}', took: 'took {t}',
    highest: 'highest guess', lowest: 'lowest guess', changed: 'changed their mind {n}×', closestAvg: 'closest to the group average',
    within: 'within {p}% (+{b} bonus)', wentOver: 'went over the bill',
  },
  sec: (s) => `${s}s`,
  minSec: (m, s) => `${m}m ${s}s`,

  chartReal: '🧾 Real {x}',
  chartAvg: 'avg {x}',
  chartLow: '◀ too low',
  chartHigh: 'too high ▶',
  tipGuess: '{name}: {amount} ({pct})',
  tipErrExact: '{name}: guessed {amount}, exactly right!',
  tipErr: (v) => `${v.name}: guessed ${v.amount}, ${v.diff} ${v.over ? 'over' : 'under'} (${v.pct})`,
  tipSpeed: '{name} answered after {t}',
  tipChanged: ' (then changed it {n}×)',
  tipPoints: (v) => `${v.name}: ${v.points} pts · ${v.wins} win${v.wins === 1 ? '' : 's'} · rounds: ${v.rounds}`,
  pts: '{n} pts',
  ariaLine: 'Number line of every guess against the real bill',
  ariaError: 'How far over or under the real bill each person was',
  ariaSpeed: 'How fast each person answered',
  ariaPoints: 'Total points across all rounds',

  errors: {
    nameRequired: 'Please enter your name', notFound: 'No dinner table with that code 🤔', full: 'This table is full!',
    notInRoom: 'Not in this room', tooLate: 'Too late — the bill was already revealed!', notPrice: 'That is not a price 😅',
    alreadyRevealed: 'Already revealed', enterActual: 'Enter the real total from the receipt', nobodyGuessed: 'Nobody has guessed yet!',
    finishRound: 'Finish this round first', tooManyRounds: 'That is a lot of dinners. Start a new table!',
    hostOnly: 'Only the host can do that', cannotRemove: 'Cannot remove that player', generic: 'Something went wrong',
  },
};

const he = {
  dir: 'rtl',
  langName: 'עברית',
  switchTo: '🇬🇧 English',
  switchAria: 'Switch to English',
  tagline: 'נחשו כמה יצא החשבון. שח-מט למשפחה! ♛',
  startTable: '🍽️ פתיחת שולחן חדש',
  codePh: 'קוד',
  codeAria: 'קוד השולחן',
  join: 'הצטרפות',
  howItWorks: 'איך זה עובד',
  how1: 'כולם מצטרפים עם הקוד או ה-QR',
  how2: 'כל אחד מנחש בסוד כמה יצא החשבון',
  how3: 'חושפים את החשבון ורואים מי צדק',
  recentTables: 'השולחנות האחרונים שלך',
  footerHome: '♛ CheckMate · נבנה לארוחות משפחתיות רועשות 🍷',
  codeLen: 'לקוד יש 4 אותיות באנגלית',
  backArrow: '→',
  back: 'חזרה',
  backHome: '→ חזרה לדף הבית',
  home: 'דף הבית',

  newTable: 'שולחן חדש',
  yourName: 'השם שלך',
  namePhHost: 'למשל: אבא',
  yourAvatar: 'האווטאר שלך',
  pickAvatarAria: 'בחירת אווטאר',
  whereEating: 'איפה אוכלים?',
  titlePh: 'ארוחת שישי אצל סבתא',
  currency: 'מטבע',
  rules: 'חוקים',
  modeClassic: '🎯 הכי קרוב מנצח',
  modeNover: '💥 אסור לעבור',
  modeClassicDesc: 'מי שהכי קרוב לסכום האמיתי מנצח — מעל או מתחת.',
  modeNoverDesc: 'הניחוש הכי קרוב שלא עובר את החשבון מנצח. ניחשת גבוה מדי? נפסלת!',
  openTable: 'פתיחת השולחן 🚪',
  defaultTitle: 'ארוחה משפחתית',
  firstRound: 'ארוחת ערב',

  dinnerTable: 'שולחן',
  tableInfo: 'שולחן {code} · {n} סביב השולחן',
  pickAvatar: 'בחרו אווטאר',
  namePhJoin: 'למשל: סבתא',
  sitDown: 'לשבת לשולחן 🪑',
  rejoinHint: 'כבר הצטרפת מטלפון אחר? הכניסו את אותו השם כדי לחזור למקום שלכם.',
  welcomeBack: 'ברוכים השבים! 👋',

  connecting: 'מתחברים לשולחן… 🍽️',
  roundN: 'סיבוב {n}',
  settingsLink: '⚙️ הגדרות שולחן',
  profileLink: '✏️ שינוי שם/אווטאר',
  shareAria: 'שיתוף קוד השולחן',
  mute: 'השתקה',
  unmute: 'ביטול השתקה',

  whatTotal: 'כמה יצא החשבון? 🤔',
  guessAria: 'הניחוש שלך לסכום החשבון',
  trashTalk: 'עקיצה (לא חובה) 😈',
  trash: ['כסף קל 😎', 'ראיתי את המחירים בתפריט 👀', 'תסמכו עליי, אני רואה חשבון', 'אינסטינקט טהור', 'מי שמפסיד משלם 😈', 'היין לא היה זול', 'אני תמיד מנצח/ת בזה'],
  lockIn: 'נעילה 🔒',
  updateGuess: 'עדכון הניחוש ✏️',
  keep: 'להשאיר {amount}',
  secretHint: 'אף אחד לא רואה את המספר שלך עד החשיפה. מהירות שווה את פרס ה-⚡!',
  lockedAfter: '✅ ננעל אחרי {t}',
  changeMind: 'התחרטתי 🔄',
  atTable: 'סביב השולחן',
  guessedCount: '{done}/{total} ניחשו',
  waitingFor: 'מחכים ל: {names} 👀',
  inviteFamily: '📲 הזמינו את המשפחה',
  thinking: 'חושב/ת…',
  inTime: '✓ תוך {t}',
  online: 'מחובר/ת',
  offline: 'לא מחובר/ת',
  removeX: 'הוצאת {name}',
  gotReceipt: '🧾 החשבון הגיע?',
  receiptHint: 'מי שמחזיק את החשבון מקליד את הסכום האמיתי — והחשיפה תקרה בכל הטלפונים ביחד.',
  realTotalPh: 'הסכום האמיתי',
  realTotalAria: 'הסכום האמיתי מהחשבון',
  reveal: 'חשיפה 🥁',
  confirmMissing: (v) => `${v.names} עוד לא ${v.count === 1 ? 'ניחש/ה' : 'ניחשו'}. לחשוף בכל זאת?`,
  typeNumber: 'קודם הקלידו מספר 🙂',
  typeReal: 'הקלידו את הסכום האמיתי מהחשבון',
  kickConfirm: 'להוציא את {name} מהשולחן?',

  realBillIs: 'החשבון האמיתי הוא…',
  skip: 'דילוג ⏭',
  theRealBillOverlay: '🧾 החשבון האמיתי',
  checkmateWins: '♛ שח-מט! {who} ניצח/ה',
  thatsYou: 'זה את/ה! 🎉',
  youWere: 'הגעת למקום {rank} · {verdict}',

  theRealBill: 'החשבון האמיתי',
  revealedBy: 'נחשף ע״י {who}',
  youLine: 'את/ה: {amount} · מקום {rank} מתוך {n} · {verdict}',
  didntGuess: 'לא ניחשת בסיבוב הזה 🙊',
  average: 'ממוצע',
  median: 'חציון',
  range: 'טווח',
  podium: '🏆 הפודיום',
  crowdTitle: '🧠 חוכמת ההמונים',
  crowdOne: 'רק ניחוש אחד בסיבוב הזה — ההמון צריך עוד אנשים! 👥',
  crowdHow: ['קרוב בצורה מפחידה 😳', 'די קרוב 👍', 'קצת רחוק 🤷', 'ממש רחוק 🙈'],
  crowdMain: (v) => `ממוצע הקבוצה (${v.avg}) היה ${v.over ? 'גבוה' : 'נמוך'} ב-${v.pct} — ${v.how}. `,
  crowdAll: 'הוא ניצח את כולם! ביחד אתם חכמים יותר 🧠',
  crowdNone: 'אבל כל אחד לבד ניצח את הממוצע. גאונים כל אחד בפני עצמו ✨',
  crowdSome: 'הוא ניצח {beat} מתוך {n} משתתפים. ',
  crowdMostOver: 'רובכם ניחשתם גבוה מדי — מרגישים עשירים? 💸',
  crowdMostUnder: 'רובכם ניחשתם נמוך מדי — המקום הזה יקר ממה שחשבתם 🧾',
  crowdSplit: 'חלוקה מושלמת בין מעל ומתחת ⚖️',
  whereLanded: '📍 איפה כל אחד נחת',
  legendReal: 'החשבון האמיתי',
  legendAvg: 'ממוצע הקבוצה',
  tapFace: 'הקישו על פרצוף לפרטים',
  howFar: '🎯 כמה רחוק?',
  legendLow: 'ניחשו נמוך מדי',
  legendHigh: 'ניחשו גבוה מדי',
  speedRace: '⚡ מרוץ המהירות',
  awardsNight: '🎖️ טקס הפרסים',
  fullResults: '📋 כל התוצאות',
  colWho: 'מי',
  colGuess: 'ניחוש',
  colOff: 'סטייה',
  exact: 'בול!',
  pointsRule: 'ניקוד: 🥇 5 · 🥈 3 · 🥉 2 · כל השאר 1 · 🎯 בול (עד 1%) +3',
  pointsRuleBust: ' · 💥 נפסל 0',
  overall: '👑 טבלת הניקוד הכללית',
  split: '💳 חלוקת החשבון',
  tip: 'טיפ',
  tipAria: 'אחוז טיפ',
  peoplePaying: 'כמה משלמים',
  fewer: 'פחות אנשים',
  more: 'יותר אנשים',
  eachPays: 'כל אחד משלם',
  totalWithTip: 'סה״כ עם טיפ {x}',
  funRule: '😈 חוק משעשע: {who} (הכי רחוק) קונה קינוח!',
  shareResults: '📤 שיתוף התוצאות',
  playAgain: 'עוד סיבוב?',
  playAgainHint: 'פותח סיבוב חדש באותו שולחן — הנקודות ממשיכות להצטבר בטבלה.',
  nextIdeas: ['קינוח 🍰', 'שתייה 🍷', 'טיפ 💁', 'הארוחה הבאה 🍽️', 'קפה ☕'],

  inviteTitle: 'הזמנה לשולחן 📲',
  scanHint: 'סרקו עם מצלמת הטלפון, או הקלידו את הקוד',
  copyLink: '📋 העתקת קישור',
  send: '📤 שליחה…',
  done: 'סגירה',
  copied: 'הועתק! 📋',
  copyFailed: 'ההעתקה נכשלה — לחיצה ארוכה כדי להעתיק',
  inviteText: 'בואו לשולחן CheckMate שלנו! מנחשים כמה יצא החשבון 🍽️ קוד: {code}',
  profileTitle: 'הפרופיל שלי',
  name: 'שם',
  save: 'שמירה',
  cancel: 'ביטול',
  saved: 'נשמר ✅',
  settingsTitle: '⚙️ הגדרות שולחן',
  tableName: 'שם השולחן',
  roundCalled: 'שם הסיבוב',

  newRound: 'סיבוב חדש: {label}',
  satDown: '{who} הצטרף/ה לשולחן',
  tableClosed: 'השולחן הזה נסגר 🍽️',
  removed: 'הוצאת מהשולחן',
  shareHeader: '♛ CheckMate — {title} ({label})',
  shareLine: 'החשבון: {real} · ממוצע הקבוצה: {avg} ({pct})',
  shareTitle: 'תוצאות CheckMate',

  verdicts: {
    calc: 'מחשבון אנושי', eagle: 'עין של נשר', sharp: 'די חד/ה', notbad: 'לא רע בכלל',
    drinks: 'שכח/ה את השתייה', champagne: 'הזמין/ה שמפניה דמיונית',
    prices2015: 'חי/ה במחירים של 2015', lobster: 'חושב/ת שאכלנו לובסטר',
    neverPaid: 'אף פעם לא שילם/ה חשבון', buyRestaurant: 'רוצה לקנות את המסעדה',
  },
  awards: {
    closest: 'הניחוש הכי קרוב', farthest: 'הכי רחוק', fastest: 'האצבע הכי מהירה', slowest: 'עדיין קורא/ת את התפריט',
    bigspender: 'ביג ספנדר', cheapskate: 'קמצן/ית', flipflop: 'מתלבט/ת', average: 'הכי ממוצע/ת',
    bullseye: 'בול פגיעה!', busted: 'נפסל/ה',
  },
  details: {
    over: 'מעל ב-{p}', under: 'מתחת ב-{p}', exact: 'בדיוק בול 🤯', answeredIn: 'ענה/תה תוך {t}', took: 'לקח {t}',
    highest: 'הניחוש הכי גבוה', lowest: 'הניחוש הכי נמוך', changed: 'שינה/תה דעה {n} פעמים', closestAvg: 'הכי קרוב לממוצע הקבוצה',
    within: 'בטווח {p}% (+{b} בונוס)', wentOver: 'עבר/ה את החשבון',
  },
  sec: (s) => `${s} שנ׳`,
  minSec: (m, s) => `${m}:${s} דק׳`,

  chartReal: '🧾 אמיתי {x}',
  chartAvg: 'ממוצע {x}',
  chartLow: '◀ נמוך מדי',
  chartHigh: 'גבוה מדי ▶',
  tipGuess: '{name}: {amount} ({pct})',
  tipErrExact: '{name}: ניחש/ה {amount} — בול!',
  tipErr: (v) => `${v.name}: ניחש/ה ${v.amount}, ${v.diff} ${v.over ? 'מעל' : 'מתחת'} (${v.pct})`,
  tipSpeed: '{name} ענה/תה אחרי {t}',
  tipChanged: ' (ואז שינה/תה {n} פעמים)',
  tipPoints: (v) => `${v.name}: ${v.points} נק׳ · ${v.wins} ניצחונות · סיבובים: ${v.rounds}`,
  pts: '{n} נק׳',
  ariaLine: 'ציר של כל הניחושים מול החשבון האמיתי',
  ariaError: 'כמה כל אחד היה מעל או מתחת לחשבון',
  ariaSpeed: 'כמה מהר כל אחד ענה',
  ariaPoints: 'סך הנקודות בכל הסיבובים',

  errors: {
    nameRequired: 'הכניסו שם', notFound: 'אין שולחן עם הקוד הזה 🤔', full: 'השולחן מלא!',
    notInRoom: 'את/ה לא בשולחן הזה', tooLate: 'מאוחר מדי — החשבון כבר נחשף!', notPrice: 'זה לא מחיר 😅',
    alreadyRevealed: 'כבר נחשף', enterActual: 'הכניסו את הסכום האמיתי מהחשבון', nobodyGuessed: 'אף אחד עוד לא ניחש!',
    finishRound: 'קודם סיימו את הסיבוב הזה', tooManyRounds: 'זה הרבה ארוחות. פתחו שולחן חדש!',
    hostOnly: 'רק המארח/ת יכול/ה לעשות את זה', cannotRemove: 'אי אפשר להוציא את המשתתף הזה', generic: 'משהו השתבש',
  },
};

const DICTS = { en, he };
const KEY = 'checkmate:lang';

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && DICTS[saved]) return saved;
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en';
  return /^(he|iw)\b/i.test(nav) ? 'he' : 'en';
}

let lang = typeof window !== 'undefined' ? detect() : 'en';

export const getLang = () => lang;
export const isRTL = () => DICTS[lang].dir === 'rtl';

export function setLang(l) {
  if (!DICTS[l]) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  applyLang();
}

export function applyLang() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = DICTS[lang].dir;
}

function lookup(key) {
  const parts = key.split('.');
  let v = DICTS[lang];
  for (const p of parts) v = v?.[p];
  if (v === undefined) { v = en; for (const p of parts) v = v?.[p]; }
  return v;
}

/** Translate a key; `{name}` placeholders are filled from vars. Function entries get vars directly. */
export function t(key, vars = {}) {
  const v = lookup(key);
  if (typeof v === 'function') return v(vars);
  if (typeof v !== 'string') return v ?? key;
  return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return t('sec', s);
  return lookup('minSec')(Math.floor(s / 60), String(s % 60).padStart(2, '0'));
}

/** Server errors carry a stable `code`; show them in the viewer's language. */
export function errorText(err) {
  const msg = err?.code && lookup('errors')?.[err.code];
  return msg || err?.message || t('errors.generic');
}
