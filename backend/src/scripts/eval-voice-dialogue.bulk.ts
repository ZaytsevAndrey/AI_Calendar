/**
 * 350 dialogue scenarios. A construction is a situation, not a wording.
 * The same situation appears at most three times. Habits are not included.
 * S/C/N pools are not part of this list.
 */

type Expect = {
  outcome: string | string[];
  kinds?: string[];
  maxIntents?: number;
  unscheduled?: boolean;
  nameIncludes?: string;
  minPlannerCalls?: number;
  noLlm?: boolean;
  planStage?: 'interview';
  actionsInclude?: string;
  planNames?: string[];
  planAbsent?: string[];
  noPlan?: boolean;
};

type Turn = { transcript?: string; expect: Expect };

export type BulkScenario = {
  id: string;
  construction: string;
  turns: Turn[];
};

const scenarios: BulkScenario[] = [];
const constructionCount = new Map<string, number>();

function add(construction: string, turns: Turn[]): void {
  const next = (constructionCount.get(construction) ?? 0) + 1;
  if (next > 3) throw new Error(`construction ${construction} used ${next} times`);
  constructionCount.set(construction, next);
  const id = `B${String(scenarios.length + 1).padStart(3, '0')}`;
  scenarios.push({ id, construction, turns });
}

function samples(construction: string, expect: Expect, lines: Array<string | [string, string]>): void {
  for (const item of lines) {
    if (typeof item === 'string') add(construction, [{ transcript: item, expect }]);
    else add(construction, [{ transcript: item[0], expect: { ...expect, nameIncludes: item[1] } }]);
  }
}

const create = (name: string, unscheduled = false): Expect => ({
  outcome: 'confirm',
  kinds: ['create'],
  maxIntents: 1,
  ...(unscheduled ? { unscheduled: true } : {}),
  nameIncludes: name,
});

const ask: Expect = {
  outcome: ['answer', 'clarify'],
  maxIntents: 0,
  minPlannerCalls: 2,
};

const clarify: Expect = { outcome: 'clarify', maxIntents: 0 };

samples('create.no.time', create('хліб', true), [
  'треба купити хліб',
  ['купи батон', 'батон'],
  ['додай справу воду', 'вод'],
]);
samples('create.duration.only', create('кава', true), [
  'кава на 20 хвилин',
  ['приготувати чай, це хвилин на 15', 'чай'],
  ['сир займе пів години', 'сир'],
]);
samples('create.day.tomorrow', create('огірки'), [
  'завтра купити огірки',
  ['на завтра помідори', 'помідор'],
  ['завтра треба цибуля', 'цибул'],
]);
samples('create.day.today', create('часник'), [
  'сьогодні купити часник',
  ['сьогодні треба морква', 'моркв'],
  ['на сьогодні капуста', 'капуст'],
]);
samples('create.day.weekday', create('рибу'), [
  'у пʼятницю купити рибу',
  ['на пʼятницю курка', 'курк'],
  ['пʼятниця, треба гречка', 'гречк'],
]);
samples('create.day.next.week', clarify, [
  'наступного тижня купити рис',
  'на наступний тиждень чай',
  'наступного тижня мед',
]);
samples('create.day.after.tomorrow', create('лимон'), [
  'післязавтра лимон',
  ['післязавтра купити апельсини', 'апельсин'],
  ['на післязавтра груші', 'груш'],
]);
samples('create.clock.today', create('дзвінок'), [
  'сьогодні о 16 дзвінок',
  ['сьогодні о 18 вечеря', 'вечер'],
  ['сьогодні о 11 здати аналізи', 'аналіз'],
]);
samples('create.clock.tomorrow', create('стоматолог'), [
  'завтра о 15 до стоматолога',
  ['завтра о 9 виліт', 'виліт'],
  ['завтра о 11 зустріч', 'зустріч'],
]);
samples('create.clock.after.tomorrow', create('захист'), [
  'післязавтра о 10 захист',
  ['післязавтра о 14 прийом', 'прийом'],
  ['післязавтра о 18 кіно', 'кіно'],
]);
samples('create.span.today', create('зустріч'), [
  'сьогодні зустріч з 15 до 16',
  ['сьогодні співбесіда з 14 до 15', 'співбесід'],
  ['сьогодні синк з 9:30 до 9:45', 'синк'],
]);
samples('create.span.tomorrow', create('конференц'), [
  'завтра з 9 до 18 конференція',
  ['завтра з 10 до 11 лікар', 'лікар'],
  ['завтра з 13 до 14 обід з командою', 'обід'],
]);
samples('create.relative.hours', create('перекур'), [
  'через годину перекур',
  ['через дві години перерва', 'перерв'],
  ['через три години дзвінок мамі', 'дзвінок'],
]);
samples('create.part.evening', create('щоденник'), [
  'ввечері щоденник',
  ['сьогодні ввечері прогулянка', 'прогулянк'],
  ['ввечері почитати', 'почитат'],
]);
samples('create.part.morning', create('зарядк'), [
  'завтра вранці зарядка',
  ['завтра зранку душ', 'душ'],
  ['завтра вранці сніданок', 'сніданок'],
]);
samples('create.after.lunch', create('лист'), [
  'після обіду розібрати листи',
  ['сьогодні після обіду аптека', 'аптек'],
  ['після обіду подзвонити в банк', 'банк'],
]);
samples('create.after.work', create('спортзал'), [
  'після роботи спортзал',
  ['сьогодні після роботи магазин', 'магазин'],
  ['після роботи забрати посилку', 'посилк'],
]);
samples('create.between.clocks', create('дзвінок'), [
  'дзвінок між 14 і 16',
  ['між 10 і 12 написати листа', 'лист'],
  ['зустріч між 17 і 19', 'зустріч'],
]);
samples('create.daily.plain', create('медитац'), [
  'щодня медитація',
  ['щодня читати', 'читат'],
  ['щодня пити воду', 'вод'],
]);
samples('create.daily.clock', create('зарядк'), [
  'щодня о 8 зарядка',
  ['щодня о 22 щоденник', 'щоденник'],
  ['щоранку о 7 розтяжка', 'розтяжк'],
]);
samples('create.weekdays.plain', create('робот'), [
  'по буднях шукати роботу',
  ['по буднях англійська', 'англійськ'],
  ['по буднях розбір пошти', 'пошт'],
]);
samples('create.weekdays.clock', create('стендап'), [
  'по буднях стендап о 10',
  ['по буднях о 9 глибока робота', 'робот'],
  ['по буднях обід о 13', 'обід'],
]);
add('create.weekends', [{ transcript: 'по вихідних прибирання', expect: clarify }]);
add('create.weekends', [{ transcript: 'по вихідних пробіжка о 9', expect: clarify }]);
add('create.weekends', [
  {
    transcript: 'у суботу і неділю прання',
    expect: { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2, nameIncludes: 'пранн' },
  },
]);
samples('create.one.weekday.clock', create('планер'), [
  'щопонеділка планерка о 9',
  ['щосереди англійська о 19', 'англійськ'],
  ['щопʼятниці огляд о 16', 'огляд'],
]);
add('create.two.weekdays', [
  {
    transcript: 'у вівторок і четвер спорт о 18',
    expect: { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2, nameIncludes: 'спорт' },
  },
]);
add('create.two.weekdays', [
  {
    transcript: 'по понеділках і пʼятницях демо о 17',
    expect: create('демо'),
  },
]);
add('create.two.weekdays', [
  {
    transcript: 'у середу і пʼятницю басейн',
    expect: { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2, nameIncludes: 'басейн' },
  },
]);
samples('create.biweekly', create('стриж'), [
  'раз на два тижні стрижка',
  ['кожну другу пʼятницю демо', 'демо'],
  ['раз на два тижні прибирання холодильника', 'холодильник'],
]);
samples('create.monthly', create('квартир'), [
  'раз на місяць плата за квартиру',
  ['першого числа платити за інтернет', 'інтернет'],
  ['щомісяця перевірити лічильники', 'лічильник'],
]);
samples('create.daily.duration', create('читат'), [
  'щодня читати 20 хвилин',
  ['щодня медитація на 10 хвилин', 'медитац'],
  ['щодня розтяжка 15 хвилин', 'розтяжк'],
]);
samples('create.before.open.task', clarify, [
  'купити хліб до звіту',
  'подзвонити мамі перед молоком',
  'аптека до того як звіт',
]);
samples('create.weekday.once.clock', create('лікар'), [
  'у пʼятницю о 16 до лікаря',
  ['у вівторок о 11 стоматолог', 'стоматолог'],
  ['у четвер о 15 банк', 'банк'],
]);
samples('create.this.weekend', create('дач'), [
  'цими вихідними на дачу',
  ['на цих вихідних прання', 'пранн'],
  ['у ці вихідні генеральне прибирання', 'прибиран'],
]);
samples('create.by.end.of.week', create('звітн'), [
  'до кінця тижня здати звітність',
  ['до кінця цього тижня оплатити рахунок', 'рахунок'],
  ['до неділі зібрати документи', 'документ'],
]);
samples('create.until.evening', create('лист'), [
  'до вечора написати лист',
  ['сьогодні до вечора закрити заявку', 'заявк'],
  ['до вечора відправити посилку', 'посилк'],
]);
samples('create.half.past', create('кава'), [
  'о пів на пʼяту кава',
  ['завтра о пів на десяту виїзд', 'виїзд'],
  ['о пів на другу обід', 'обід'],
]);
samples('create.quarter.to', create('зустріч'), [
  'за чверть шоста зустріч',
  ['завтра за чверть девʼята літак', 'літак'],
  ['за чверть третя дзвінок', 'дзвінок'],
]);
add('create.bare.afternoon.hour', [
  { transcript: 'о третій зустріч', expect: create('зустріч') },
]);
add('create.bare.afternoon.hour', [
  { transcript: 'о четвертій забрати дитину', expect: create('дитин') },
]);
add('create.bare.afternoon.hour', [
  { transcript: 'о пʼятій спорт', expect: clarify },
]);
samples('create.place.not.travel', create('офіс'), [
  'завтра о 10 зустріч в офісі',
  ['сьогодні о 16 кава на Подолі', 'подол'],
  ['завтра о 12 обід у кафе', 'кафе'],
]);
samples('create.if.time', create('книжк', true), [
  'якщо буде час, почитати книжку',
  ['як встигну, розібрати шафу', 'шаф'],
  ['коли буде вікно, полити квіти', 'квіт'],
]);
samples('create.correct.clock', create('лікар'), [
  'лікар о 3, ні, о 4',
  ['дзвінок о 10… ні, о 11', 'дзвінок'],
  ['зустріч о 15, краще о 16', 'зустріч'],
]);
samples('create.correct.day', create('аптек'), [
  'аптека сьогодні… ні, завтра',
  ['магазин завтра, ні, сьогодні', 'магазин'],
  ['банк у пʼятницю… ні, у четвер', 'банк'],
]);
samples('create.after.filler', create('хліб', true), [
  'ну коротше, купити хліб',
  ['ем, треба батон', 'батон'],
  ['слухай, запиши воду', 'вод'],
]);
samples('create.compound.and', create('хліб', true), [
  'додай задачу купити хліб і масло',
  ['купити чай і цукор', 'цукор'],
  ['треба сіль і перець', 'перець'],
]);
samples('create.two.errands', { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2, nameIncludes: 'хліб' }, [
  'купи хліб і запиши подзвонити мамі',
  ['треба батон і треба кава', 'батон'],
  ['додай воду і додай сир', 'сир'],
]);
samples('create.three.errands', { outcome: 'confirm', kinds: ['create', 'create', 'create'], maxIntents: 3, nameIncludes: 'ліки' }, [
  'завтра треба купити ліки, забрати посилку і записатися до лікаря',
  ['купи хліб, запиши каву і додай сир', 'сир'],
  ['треба яйця, треба риба і треба рис', 'рис'],
]);
samples('create.two.share.day', { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2, nameIncludes: 'хліб' }, [
  'завтра купити хліб і забрати посилку',
  ['у пʼятницю лікар і аптека', 'аптек'],
  ['сьогодні банк і пошта', 'пошт'],
]);
samples('create.no.name', clarify, [
  'додай задачу',
  'створи справу',
  'запиши щось',
]);
samples('create.time.without.name', clarify, [
  'завтра о 15',
  'сьогодні ввечері',
  'о четвертій',
]);
samples('create.someday', create('книжк', true), [
  'колись почитати книжку',
  ['коли-небудь розібрати фото', 'фото'],
  ['колись купити пальто', 'пальто'],
]);

samples('complete.named', { outcome: 'confirm', kinds: ['complete'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'закінчив звіт',
  'зробив звіт',
  ['закінчив молоко', 'молоко'],
]);
samples('complete.unknown', clarify, [
  'закінчив марсіанський звіт',
  'готово квантова фізика',
  'зробив орбіту',
]);
samples('complete.pronoun', clarify, [
  'закінчив це',
  'готово її',
  'зробив ту штуку',
]);
samples('delete.named', { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'видали звіт',
  ['прибери молоко', 'молоко'],
  'скасуй задачу звіт',
]);
samples('delete.pronoun', clarify, [
  'видали це',
  'прибери її',
  'скасуй ту штуку',
]);
samples('delete.unknown', clarify, [
  'видали квантову фізику',
  'прибери орбіту',
  'скасуй марсіанський звіт',
]);
samples('delete.series.all', { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'ym' }, [
  'видали всю серію gym',
  'прибери gym повністю',
  'скасуй усі gym',
]);
samples('delete.series.no.scope', clarify, [
  'видали gym',
  'прибери gym',
  'скасуй gym',
]);
samples('wont.today', { outcome: 'confirm', kinds: ['cancel'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'сьогодні не буде звіту',
  'звіт сьогодні не роблю',
  ['молоко сьогодні відпадає', 'молоко'],
]);
samples('wont.today.unnamed', clarify, [
  'сьогодні її не буде',
  'її сьогодні не роблю',
  'ту штуку сьогодні відміняю',
]);
samples('wont.today.unknown', clarify, [
  'сьогодні не буде орбіти',
  'орбіта сьогодні відпадає',
  'квантової фізики сьогодні не буде',
]);
samples('move.day', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'перенеси звіт на завтра',
  'звіт на пʼятницю',
  ['перенеси молоко на завтра', 'молоко'],
]);
samples('move.clock', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'молоко' }, [
  'перенеси молоко на 15:00',
  ['звіт на 18:00', 'звіт'],
  'постав молоко на 11',
]);
samples('move.window', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'перенеси звіт між 14 і 18',
  ['молоко між 10 і 12', 'молоко'],
  'звіт з 16 до 19',
]);
samples('move.now', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'зроби звіт зараз',
  ['молоко зараз', 'молоко'],
  'звіт прямо зараз',
]);
samples('move.no.when', clarify, [
  'перенеси звіт',
  'посунь молоко',
  'перестав звіт',
]);
samples('move.pronoun.day', clarify, [
  'перенеси це на завтра',
  'її на 15:00',
  'ту штуку на вечір',
]);
samples('move.correct.day', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'перенеси звіт на сьогодні… ні, на завтра',
  ['молоко на пʼятницю, ні, на завтра', 'молоко'],
  'звіт на вечір… ні, на завтра',
]);
samples('update.rename', { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'молоко' }, [
  'перейменуй молоко на хліб',
  'молоко тепер кефір',
  'назви молоко батоном',
]);
samples('update.priority', { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'зроби звіт терміновим',
  'звіт не горить, низький пріоритет',
  ['молоко термінове', 'молоко'],
]);
add('update.deadline', [
  {
    transcript: 'дедлайн звіту на завтра',
    expect: { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'звіт' },
  },
]);
add('update.deadline', [
  { transcript: 'молоко треба до пʼятниці', expect: clarify },
]);
add('update.deadline', [{ transcript: 'звіт до вечора', expect: clarify }]);
samples('update.duration', clarify, [
  'звіт на годину',
  'молоко займе 20 хвилин',
  'звіт на пів години',
]);
add('update.description', [
  {
    transcript: 'додай до звіту опис фінальна версія',
    expect: { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'звіт' },
  },
]);
add('update.description', [
  {
    transcript: 'у молоко допиши знежирене',
    expect: { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'молоко' },
  },
]);
add('update.description', [
  { transcript: 'звіт: коментар для шефа', expect: clarify },
]);
samples('update.no.change', clarify, [
  'онови звіт',
  'зміни молоко',
  'відредагуй звіт',
]);
samples('update.pronoun', clarify, [
  'зроби її терміновою',
  'перейменуй це на хліб',
  'дедлайн її на завтра',
]);

samples('ask.agenda.today', ask, [
  'що в мене на сьогодні',
  'що сьогодні в календарі',
  'покажи сьогоднішній день',
]);
samples('ask.gaps.today', ask, [
  'коли я вільний сьогодні',
  'які вільні вікна сьогодні',
  'де сьогодні вільно',
]);
samples('ask.unscheduled', ask, [
  'що незаплановане',
  'які задачі без часу',
  'перелічи незаплановані',
]);
samples('ask.now.next', ask, [
  'що в мене далі',
  'яка наступна справа',
  'що зараз по розкладу',
]);
samples('ask.agenda.tomorrow', ask, [
  'що в мене завтра',
  'що завтра в календарі',
  'покажи завтра',
]);
samples('ask.one.task', ask, [
  'що з звітом',
  'де стоїть молоко',
  'звіт на коли',
]);

samples('plan.today', {
  outcome: 'clarify',
  maxIntents: 0,
  planStage: 'interview',
  actionsInclude: 'build_plan',
  planNames: ['Звіт', 'Молоко'],
}, [
  'сплануй сьогодні',
  'склади план на сьогодні',
  'розклади сьогоднішній день',
]);

samples('noise.thanks', { outcome: 'answer', maxIntents: 0, noLlm: true }, [
  'дякую',
  'дуже дякую',
  'дякую дуже',
]);

samples('mix.create.delete', { outcome: 'confirm', kinds: ['create', 'delete'], nameIncludes: 'хліб' }, [
  'купи хліб і видали молоко',
  ['додай батон і прибери звіт', 'батон'],
  ['запиши воду і скасуй молоко', 'вод'],
]);
samples('mix.move.create', { outcome: 'confirm', kinds: ['window|shift|update', 'create'], nameIncludes: 'звіт' }, [
  'перенеси звіт на завтра і додай прибрати кухню',
  ['молоко на 15:00 і купи хліб', 'хліб'],
  'звіт на вечір і запиши каву',
]);
samples('mix.complete.create', { outcome: 'confirm', kinds: ['complete', 'create'], nameIncludes: 'звіт' }, [
  'закінчив звіт і купи хліб',
  ['молоко готове, додай батон', 'батон'],
  'зробив звіт і запиши воду',
]);
samples('mix.complete.move', { outcome: 'confirm', kinds: ['complete', 'window|shift|update'], nameIncludes: 'звіт' }, [
  'закінчив звіт і перенеси молоко на завтра',
  'молоко готове, звіт на 15:00',
  'зробив молоко і звіт на вечір',
]);
samples('mix.question.create', { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'хліб' }, [
  'що сьогодні і купи хліб',
  ['коли я вільний, і додай батон', 'батон'],
  ['що незаплановане, запиши воду', 'вод'],
]);
samples('mix.delete.move', { outcome: 'confirm', kinds: ['delete', 'window|shift|update'] }, [
  'видали молоко і перенеси звіт на завтра',
  'прибери звіт і молоко на 15:00',
  'скасуй молоко, звіт на вечір',
]);
samples('mix.two.deletes', { outcome: 'confirm', kinds: ['delete', 'delete'] }, [
  'видали звіт і видали молоко',
  'прибери молоко і звіт',
  'скасуй звіт, скасуй молоко',
]);
samples('wont.today.and.create', { outcome: 'confirm', kinds: ['cancel', 'create'], nameIncludes: 'хліб' }, [
  'сьогодні без звіту, і купи хліб',
  ['молока сьогодні не буде, додай батон', 'батон'],
  ['сьогодні звіт відпадає, запиши воду', 'вод'],
]);

samples('create.deadline.clock', create('лист'), [
  'лист до 18:00',
  ['заявку здати до 16', 'заявк'],
  ['дзвінок до полудня', 'дзвінок'],
]);
samples('create.earliest.clock', create('дзвінок'), [
  'дзвінок не раніше 15',
  ['зустріч після 17', 'зустріч'],
  ['не раніше 11 подзвонити в банк', 'банк'],
]);
samples('create.duration.and.clock', create('зустріч'), [
  'завтра о 11 зустріч на 45 хвилин',
  ['сьогодні о 16 дзвінок на 20 хвилин', 'дзвінок'],
  ['о 10 нарада на годину', 'нарад'],
]);
add('create.duration.and.day', [
  { transcript: 'завтра звітність на годину', expect: clarify },
]);
add('create.duration.and.day', [
  {
    transcript: 'у пʼятницю прибирання на дві години',
    expect: create('прибиран'),
  },
]);
add('create.duration.and.day', [
  {
    transcript: 'сьогодні листа написати за 30 хвилин',
    expect: create('лист'),
  },
]);
samples('create.window.plus.preferred', create('дзвінок'), [
  'дзвінок між 14 і 18, краще о 16',
  ['дзвінок між 10 і 13, бажано о 11', 'дзвінок'],
  ['сьогодні з 15 до 19 зустріч, краще о 17', 'зустріч'],
]);
samples('create.not.before.not.after', create('спорт'), [
  'спорт не раніше 18 і не пізніше 21',
  ['дзвінок після 14 і до 17', 'дзвінок'],
  ['зустріч не раніше 10 і не пізніше 12', 'зустріч'],
]);
samples('create.all.day', create('конференц'), [
  'завтра весь день конференція',
  ['у пʼятницю цілий день на дачі', 'дач'],
  ['сьогодні на цілий день відрядження', 'відряджен'],
]);
samples('create.with.person', create('обід'), [
  'завтра обід з Олегом',
  ['сьогодні дзвінок з мамою', 'дзвінок'],
  ['у четвер зустріч з клієнтом', 'клієнт'],
]);
samples('create.two.clocks.last', create('лікар'), [
  'лікар о 3 або о 4, хай о 4',
  ['дзвінок о 10 чи о 11, о 11', 'дзвінок'],
  ['зустріч о 15 або о 16, берімо 16', 'зустріч'],
]);
samples('create.two.days.last', create('аптек'), [
  'аптека сьогодні або завтра, завтра',
  ['банк у четвер чи в пʼятницю, у пʼятницю', 'банк'],
  ['лікар завтра або післязавтра, післязавтра', 'лікар'],
]);
samples('update.clear.time', { outcome: 'confirm', kinds: ['update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'зніми час зі звіту',
  ['молоко без години', 'молоко'],
  'звіт зроби без часу',
]);
samples('mix.question.complete', { outcome: 'confirm', kinds: ['complete'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'що сьогодні, і звіт готовий',
  ['коли вільно, молоко зробив', 'молоко'],
  'що далі, закінчив звіт',
]);
samples('mix.rename.and.create', { outcome: 'confirm', kinds: ['update', 'create'], nameIncludes: 'молоко' }, [
  'перейменуй молоко на кефір і купи хліб',
  ['звіт тепер звітність, додай батон', 'батон'],
  'назви молоко сиром і запиши воду',
]);
samples('mix.priority.and.move', { outcome: 'confirm', kinds: ['update', 'window|shift|update'], nameIncludes: 'звіт' }, [
  'звіт терміновий і перенеси його на завтра',
  ['молоко низький пріоритет і на 15:00', 'молоко'],
  'зроби звіт терміновим і постав на вечір',
]);

add('dialogue.hold.then.answer', [
  { transcript: 'купи хліб і перенеси ту штуку', expect: clarify },
  {
    transcript: 'звіт, на завтра',
    expect: { outcome: 'confirm', kinds: ['create', 'window|shift|update'], nameIncludes: 'хліб' },
  },
]);
add('dialogue.revise.final.time', [
  {
    transcript: 'додай спортзал на 18 і перенеси її на 19',
    expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'спорт' },
  },
]);
add('dialogue.drop.after.two.blanks', [
  { transcript: 'купи батон і перенеси оце', expect: clarify },
  { transcript: 'не знаю яку', expect: clarify },
  {
    transcript: 'та й байдуже',
    expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'батон' },
  },
]);
add('dialogue.other.day.while.plan', [
  {
    transcript: 'допоможи з планом на сьогодні',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: ['Звіт', 'Молоко'],
    },
  },
  {
    transcript: 'завтра треба купити хліб',
    expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'хліб' },
  },
]);
add('dialogue.no.intent.then.refuse', [
  { transcript: 'ну таке, зроби щось', expect: { ...clarify, noPlan: true } as Expect },
  { transcript: 'ну не знаю', expect: { ...clarify, noPlan: true } as Expect },
  { transcript: 'та байдуже', expect: { outcome: 'refuse', maxIntents: 0, noPlan: true } as Expect },
]);
add('dialogue.plan.edit', [
  {
    transcript: 'зроби мені план на сьогодні',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
    },
  },
  {
    transcript: 'прибери молоко і додай спортзал',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      planNames: ['Звіт', 'спортзал'],
      planAbsent: ['Молоко'],
    },
  },
]);

samples('create.preferred.clock', create('кава'), [
  'десь о 16 кава',
  ['сьогодні близько 11 дзвінок', 'дзвінок'],
  ['завтра орієнтовно о 19 вечеря', 'вечер'],
]);
samples('create.morning.today', create('зарядк'), [
  'сьогодні вранці зарядка',
  ['сьогодні зранку душ', 'душ'],
  ['сьогодні вранці сніданок', 'сніданок'],
]);
samples('create.evening.tomorrow', create('кіно'), [
  'завтра ввечері кіно',
  ['завтра ввечері прогулянка', 'прогулянк'],
  ['завтра ввечері щоденник', 'щоденник'],
]);
samples('create.urgent.new', create('ліки', true), [
  'терміново купити ліки',
  ['терміново забрати посилку', 'посилк'],
  ['терміново подзвонити в банк', 'банк'],
]);
samples('create.place.only', create('офіс', true), [
  'зустріч в офісі',
  ['кава на Подолі', 'подол'],
  ['обід у кафе', 'кафе'],
]);
samples('move.part.of.day', { outcome: 'confirm', kinds: ['window|shift|update'], maxIntents: 1, nameIncludes: 'звіт' }, [
  'перенеси звіт на вечір',
  ['молоко на ранок', 'молоко'],
  ['звіт після обіду', 'звіт'],
]);
samples('complete.series.today', { outcome: 'refuse', maxIntents: 0 }, [
  'закінчив gym на сьогодні',
  'сьогоднішній gym готовий',
  'сьогодні gym вже зробив',
]);
samples('move.series.no.scope', clarify, [
  'перенеси gym на завтра',
  'gym на 18:00',
  'посунь gym на вечір',
]);
samples('ask.week', ask, [
  'що в мене на цей тиждень',
  'покажи тиждень',
  'що на тижні в календарі',
]);
samples('ask.weekday', ask, [
  'що в мене в пʼятницю',
  'покажи четвер',
  'що в середу',
]);
add('dialogue.confirm.delete', [
  {
    transcript: 'будь ласка прибери звіт',
    expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' },
  },
  { transcript: 'так, видаляй', expect: { outcome: 'act', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' } },
]);
add('dialogue.confirm.delete', [
  {
    transcript: 'звіт прибери, прошу',
    expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' },
  },
  { transcript: 'так', expect: { outcome: 'act', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' } },
]);
add('dialogue.confirm.delete', [
  {
    transcript: 'молоко прибери, прошу',
    expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'молоко' },
  },
  { transcript: 'давай прибирай', expect: { outcome: 'act', kinds: ['delete'], maxIntents: 1, nameIncludes: 'молоко' } },
]);
add('dialogue.decline.delete', [
  {
    transcript: 'прошу прибрати звіт',
    expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'звіт' },
  },
  { transcript: 'ні, не треба', expect: { outcome: 'answer', maxIntents: 0 } },
]);
add('dialogue.decline.delete', [
  {
    transcript: 'будь ласка прибери молоко',
    expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1, nameIncludes: 'молоко' },
  },
  { transcript: 'ні, залиш', expect: { outcome: 'answer', maxIntents: 0 } },
]);

export const BULK: BulkScenario[] = scenarios;

const texts = scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.transcript ?? ''));
const seen = new Map<string, number>();
for (const text of texts) seen.set(text, (seen.get(text) ?? 0) + 1);
const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([text]) => text);
const missingNeedle = scenarios.flatMap((scenario) => {
  const spoken = scenario.turns.map((turn) => turn.transcript ?? '').join('\n').toLowerCase();
  return scenario.turns.flatMap((turn) => {
    const needle = turn.expect.nameIncludes?.toLowerCase();
    if (!needle || spoken.includes(needle)) return [];
    return [`${scenario.construction}: "${turn.transcript}" lacks ${needle}`];
  });
});
const maxRepeat = Math.max(...constructionCount.values());
if (
  scenarios.length !== 350 ||
  duplicates.length > 0 ||
  missingNeedle.length > 0 ||
  maxRepeat > 3
) {
  throw new Error(
    [
      `bulk corpus ${scenarios.length} scenarios, ${constructionCount.size} constructions, max repeat ${maxRepeat}`,
      duplicates.length ? `duplicates: ${duplicates.join(' | ')}` : '',
      missingNeedle.length ? `needles: ${missingNeedle.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
