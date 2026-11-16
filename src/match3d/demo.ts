import type { MatchEvent, MatchPayload, TeamColors } from './types';

export type DemoPresetId = 'night_rain' | 'day_clear' | 'snow_derby';

export interface DemoClubHint {
  id?: string;
  name: string;
  logo?: string;
  colors?: TeamColors;
  stadium?: string;
  city?: string;
}

export interface DemoBundle {
  payload: MatchPayload;
  events: MatchEvent[];
  title: string;
  subtitle: string;
}

function makeDemoSquad(prefix: string, names: string[], formation: string) {
  return {
    formation,
    starters: names.slice(0, 11).map((name, i) => ({
      id: `${prefix}_s${i}`,
      name,
      pos: i === 0 ? 'ВР' : i <= 4 ? 'ЗЩ' : i <= 8 ? 'ПЗ' : 'НП',
    })),
    bench: names.slice(11).map((name, i) => ({
      id: `${prefix}_b${i}`,
      name,
      pos: i === 0 ? 'ВР' : 'ПЗ',
    })),
  };
}

export function buildDemoMatch(
  preset: DemoPresetId = 'night_rain',
  customClubs?: {
    home?: DemoClubHint;
    away?: DemoClubHint;
    city?: string;
    gameDate?: string;
    weather?: string;
    gameTime?: string;
    weatherDetails?: MatchPayload['fixture']['weatherDetails'];
  }
): DemoBundle {
  const presets: Record<DemoPresetId, {
    homeName: string;
    awayName: string;
    homeColors: TeamColors;
    awayColors: TeamColors;
    stadium: string;
    weather: string;
    gameTime: string;
    homeNames: string[];
    awayNames: string[];
    homeForm: string;
    awayForm: string;
    subtitle: string;
  }> = {
    night_rain: {
      homeName: 'Зенит',
      awayName: 'Спартак',
      homeColors: { primary: '#1e88e5', secondary: '#ffffff' },
      awayColors: { primary: '#e53935', secondary: '#ffffff' },
      stadium: 'Газпром Арена, Санкт-Петербург',
      weather: 'Дождь, +9°C',
      gameTime: '19:30',
      homeForm: '4-2-3-1',
      awayForm: '4-3-3',
      subtitle: 'Вечерние прожекторы · Дождь · Битва лидеров',
      homeNames: [
        'Евгений Латышонок', 'Вячеслав Караваев', 'Нино Мота', 'Страхиня Эракович', 'Дуглас Сантос',
        'Вильмар Барриос', 'Вендел да Силва', 'Максим Глушенков', 'Клаудиньо', 'Педро Энрике', 'Матео Кассьерра',
        'Михаил Кержаков', 'Александр Соболев', 'Артур Гимарайнс',
      ],
      awayNames: [
        'Александр Максименко', 'Даниил Денисов', 'Срджан Бабич', 'Алексис Дуарте', 'Олег Рябчук',
        'Наиль Умяров', 'Кристофер Мартинс', 'Эсекьель Барко', 'Тео Бонгонда', 'Маркиньос', 'Манфред Угальде',
        'Илья Помазун', 'Роман Зобнин', 'Антон Зиньковский',
      ],
    },
    day_clear: {
      homeName: 'ЦСКА',
      awayName: 'Динамо Москва',
      homeColors: { primary: '#c62828', secondary: '#1565c0' },
      awayColors: { primary: '#1976d2', secondary: '#ffffff' },
      stadium: 'ВЭБ Арена, Москва',
      weather: 'Ясно, +21°C',
      gameTime: '14:00',
      homeForm: '3-4-2-1',
      awayForm: '4-3-3',
      subtitle: 'Дневное солнце · Братское дерби · Тест контраста форм',
      homeNames: [
        'Игорь Акинфеев', 'Игорь Дивеев', 'Виллиан Роша', 'Мойзес Барбоза', 'Келлвен',
        'Иван Обляков', 'Саша Зделар', 'Данил Круговой', 'Аббосбек Файзуллаев', 'Тамерлан Мусаев', 'Сауль Гуарирапа',
        'Владислав Тороп', 'Миралем Пьянич', 'Кирилл Глебов',
      ],
      awayNames: [
        'Андрей Лунёв', 'Эли Даса', 'Фабиан Бальбуэна', 'Роберто Фернандес', 'Дмитрий Скопинцев',
        'Луис Чавес', 'Даниил Фомин', 'Бителло да Силва', 'Муми Нгамалё', 'Хорхе Карраскаль', 'Константин Тюкавин',
        'Игорь Лещук', 'Артур Гомес', 'Ярослав Гладышев',
      ],
    },
    snow_derby: {
      homeName: 'Краснодар',
      awayName: 'Локомотив',
      homeColors: { primary: '#1b5e20', secondary: '#000000' },
      awayColors: { primary: '#2e7d32', secondary: '#c62828' },
      stadium: 'Ozon Арена, Краснодар',
      weather: 'Снег, -2°C',
      gameTime: '18:30',
      homeForm: '4-2-3-1',
      awayForm: '4-2-3-1',
      subtitle: 'Зимний снег · Вечерний стадион · Интенсивные стандарты',
      homeNames: [
        'Станислав Агкацев', 'Сергей Петров', 'Витор Тормена', 'Диего Коста', 'Лукас Оласа',
        'Александр Черников', 'Кевин Ленини', 'Эдуард Сперцян', 'Жоао Батчи', 'Виктор Са', 'Джон Кордоба',
        'Юрий Дюпин', 'Никита Кривцов', 'Фёдор Смолов',
      ],
      awayNames: [
        'Илья Лантратов', 'Максим Ненахов', 'Сесар Монтес', 'Жерзино Ньямси', 'Александр Сильянов',
        'Дмитрий Баринов', 'Артём Карпукас', 'Алексей Батраков', 'Сергей Пиняев', 'Илья Самошников', 'Дмитрий Воробьёв',
        'Антон Митрюшкин', 'Тимур Сулейманов', 'Вадим Раков',
      ],
    },
  };

  const cfg = presets[preset] || presets.night_rain;
  const hName = customClubs?.home?.name || cfg.homeName;
  const aName = customClubs?.away?.name || cfg.awayName;
  const hColors = customClubs?.home?.colors || cfg.homeColors;
  const aColors = customClubs?.away?.colors || cfg.awayColors;

  const homeLu = makeDemoSquad('dh', cfg.homeNames, cfg.homeForm);
  const awayLu = makeDemoSquad('da', cfg.awayNames, cfg.awayForm);

  const resolvedCity = customClubs?.city || customClubs?.home?.city || cfg.stadium.split(',').pop()?.trim() || 'Москва';
  const resolvedWeather = customClubs?.weather || cfg.weather;
  const resolvedTime = customClubs?.gameTime || cfg.gameTime;
  const resolvedDate = customClubs?.gameDate || '2026-10-15';
  const wKindSuffix = customClubs?.weatherDetails?.weatherKind || '';

  const payload: MatchPayload = {
    fixture: {
      id: `demo_${preset}_${resolvedCity}_${resolvedDate}_${resolvedTime}_${wKindSuffix}_${hName}_${aName}`,
      comp: 'rpl',
      label: 'Демо-трансляция 3D · РПЛ',
      home: customClubs?.home?.id || 'demo_home',
      away: customClubs?.away?.id || 'demo_away',
      homeName: hName,
      awayName: aName,
      homeLogo: customClubs?.home?.logo || '',
      awayLogo: customClubs?.away?.logo || '',
      homeColors: hColors,
      awayColors: aColors,
      status: 'done',
      hg: 2,
      ag: 1,
      city: resolvedCity,
      stadium: customClubs?.home?.stadium || cfg.stadium,
      gameDate: resolvedDate,
      gameTime: resolvedTime,
      weather: resolvedWeather,
      weatherDetails: customClubs?.weatherDetails || null,
    },
    lineups: {
      home: { name: hName, ...homeLu },
      away: { name: aName, ...awayLu },
    },
    ctx: {
      comp: 'Мир РПЛ · Демонстрационный матч',
      roundLabel: '3D-тест',
      stadium: customClubs?.home?.stadium || cfg.stadium,
      weather: resolvedWeather,
      weatherDetails: customClubs?.weatherDetails || null,
    },
  };

  const hAtk = homeLu.starters[10];
  const hMid = homeLu.starters[8];
  const hWing = homeLu.starters[7];
  const hDef = homeLu.starters[2];
  const hSub = homeLu.bench[1] || homeLu.starters[9];
  const hGk = homeLu.starters[0];

  const aAtk = awayLu.starters[10];
  const aMid = awayLu.starters[7];
  const aWing = awayLu.starters[8];
  const aDef = awayLu.starters[3];
  const aGk = awayLu.starters[0];

  const events: MatchEvent[] = [
    {
      i: 0, min: 0, sec: 0, team: 'home', type: 'kickoff',
      pids: [hAtk.id, hMid.id], players: [hAtk.name],
      text: `Стартовый свисток! «${hName}» и «${aName}» начинают демонстрационный матч!`,
      score: [0, 0],
    },
    {
      i: 1, min: 3, sec: 10, team: 'home', type: 'pass',
      pids: [hMid.id, hWing.id], players: [hMid.name, hWing.name],
      text: `${hMid.name} разрезающим пасом выводит на правый фланг ${hWing.name}.`,
      score: [0, 0],
    },
    {
      i: 2, min: 7, sec: 25, team: 'home', type: 'dribble',
      pids: [hWing.id, aDef.id], players: [hWing.name],
      text: `Дриблинг! ${hWing.name} на скорости смещается в центр мимо защитника!`,
      score: [0, 0],
    },
    {
      i: 3, min: 12, sec: 40, team: 'home', type: 'save',
      pids: [hAtk.id, aGk.id], players: [hAtk.name, aGk.name],
      text: `Опасный удар в угол штрафной — ${aGk.name} в эффектном прыжке спасает «${aName}»!`,
      xg: 0.34, score: [0, 0],
    },
    {
      i: 4, min: 18, sec: 5, team: 'home', type: 'corner',
      pids: [hWing.id, hDef.id], players: [hWing.name],
      text: `${hWing.name} выполняет кручёный навес с углового флажка во вратарскую!`,
      score: [0, 0],
    },
    {
      i: 5, min: 24, sec: 15, team: 'home', type: 'goal',
      pids: [hAtk.id, hMid.id], players: [hAtk.name, hMid.name],
      text: `ГОООЛ! ${hAtk.name} после передачи в штрафную мощным ударом поражает девятку ворот!`,
      xg: 0.42, score: [1, 0],
    },
    {
      i: 6, min: 33, sec: 0, team: 'away', type: 'yellow',
      pids: [aDef.id], players: [aDef.name],
      text: `Жёлтая карточка! ${aDef.name} срывает быструю атаку хозяев жёстким подкатом.`,
      score: [1, 0],
    },
    {
      i: 7, min: 41, sec: 30, team: 'away', type: 'post',
      pids: [aAtk.id], players: [aAtk.name],
      text: `ШТАНГА! ${aAtk.name} бьёт с левой ноги из-за штрафной — мяч со звоном сотрясает каркас!`,
      xg: 0.28, score: [1, 0],
    },
    {
      i: 8, min: 45, sec: 0, team: 'none', type: 'halftime',
      pids: [], players: [],
      text: `Перерыв! Команды уходят отдыхать при счёте 1:0, а во 2-м тайме меняются воротами.`,
      score: [1, 0],
    },
    {
      i: 9, min: 52, sec: 10, team: 'home', type: 'sub',
      pids: [hSub.id, hWing.id], players: [hSub.name, hWing.name],
      text: `Замена у «${hName}»: свежий ${hSub.name} выходит вместо ${hWing.name}.`,
      score: [1, 0],
    },
    {
      i: 10, min: 59, sec: 45, team: 'away', type: 'freekick',
      pids: [aMid.id], players: [aMid.name],
      text: `Опасный штрафной! ${aMid.name} обводит стенку, мяч летит над самой перекладиной.`,
      score: [1, 0],
    },
    {
      i: 11, min: 66, sec: 20, team: 'away', type: 'goal',
      pids: [aWing.id, aMid.id], players: [aWing.name],
      text: `ГОООЛ! «${aName}» сравнивает счёт! ${aWing.name} завершает стремительную контратаку!`,
      xg: 0.49, score: [1, 1],
    },
    {
      i: 12, min: 76, sec: 5, team: 'home', type: 'penalty',
      pids: [hMid.id, aGk.id], players: [hMid.name],
      text: `ПЕНАЛЬТИ в ворота «${aName}»! Арбитр указывает на 11-метровую отметку!`,
      xg: 0.78, score: [1, 1],
    },
    {
      i: 13, min: 77, sec: 0, team: 'home', type: 'goal',
      pids: [hMid.id], players: [hMid.name],
      text: `ГОООЛ! ${hMid.name} хладнокровно реализует пенальти в нижний угол ворот!`,
      xg: 0.78, score: [2, 1],
    },
    {
      i: 14, min: 84, sec: 30, team: 'away', type: 'red',
      pids: [aDef.id], players: [aDef.name],
      text: `КРАСНАЯ КАРТОЧКА! ${aDef.name} получает второе предупреждение и покидает поле!`,
      score: [2, 1],
    },
    {
      i: 15, min: 88, sec: 15, team: 'away', type: 'save',
      pids: [aAtk.id, hGk.id], players: [aAtk.name, hGk.name],
      text: `Финальный штурм гостей — ${hGk.name} намертво забирает мяч после удара в упор!`,
      xg: 0.31, score: [2, 1],
    },
    {
      i: 16, min: 90, sec: 0, team: 'none', type: 'fulltime',
      pids: [], players: [],
      text: `Финальный свисток! Победа «${hName}» 2:1 в демонстрационном 3D-матче!`,
      score: [2, 1],
    },
  ];

  return {
    payload,
    events,
    title: `${hName} — ${aName}`,
    subtitle: cfg.subtitle,
  };
}
