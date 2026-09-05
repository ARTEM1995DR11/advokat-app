export interface Deadline {
  id: string;
  title: string;
  caseNo: string;
  status: string;
  overdue: boolean;
}

export interface Hearing {
  id: string;
  time: string;
  caseNo: string;
  place: string;
}

export interface TaskItem {
  id: string;
  title: string;
  sub: string;
  time: string;
  done: boolean;
  group: "today" | "upcoming";
}

export interface UpcomingHearing {
  id: string;
  date: string;
  time: string;
  caseNo: string;
  place: string;
}

export interface CaseItem {
  id: string;
  caseNo: string;
  status: string;
  statusTone: "active" | "prep" | "archive";
  client: string;
  court: string;
  subject: string;
  claim: string;
  next: string;
}

export interface CalDay {
  time: string;
  caseNo: string;
  place: string;
  type: string;
}

export const overdueDeadlines: Deadline[] = [
  { id: "d1", title: "Апелляционная жалоба", caseNo: "по делу № А56-12345/2024", status: "Истёк срок 2 дня назад", overdue: true },
  { id: "d2", title: "Отзыв на исковое заявление", caseNo: "по делу № 2-345/2024", status: "Истёк срок вчера", overdue: true },
];

export const todayHearings: Hearing[] = [
  { id: "h1", time: "10:30", caseNo: "А56-12345/2024", place: "Кинешемский городской суд, зал 3" },
  { id: "h2", time: "15:00", caseNo: "2-678/2024", place: "Кинешемский городской суд, зал 2" },
  { id: "h3", time: "18:00", caseNo: "Встреча с доверителем", place: "ООО «СтройИнвест», офис" },
];

export const upcomingHearings: UpcomingHearing[] = [
  { id: "u1", date: "22 мая, ср", time: "11:00", caseNo: "А40-98765/2024", place: "Арбитражный суд г. Москвы, зал 5" },
  { id: "u2", date: "23 мая, чт", time: "14:30", caseNo: "2-345/2024", place: "Кинешемский городской суд, зал 2" },
];

export const tasks: TaskItem[] = [
  { id: "t1", title: "Подготовить ходатайство", sub: "по делу № А56-12345/2024", time: "09:00", done: true, group: "today" },
  { id: "t2", title: "Подготовить правовую позицию", sub: "по делу № 2-678/2024", time: "12:00", done: true, group: "today" },
  { id: "t3", title: "Согласовать мировое соглашение", sub: "по делу № А40-98765/2024", time: "16:00", done: false, group: "today" },
  { id: "t4", title: "Составить кассационную жалобу", sub: "по делу № А56-98765/2024", time: "21 мая", done: false, group: "upcoming" },
  { id: "t5", title: "Подготовить доверенность", sub: "для участия в заседании", time: "21 мая", done: false, group: "upcoming" },
  { id: "t6", title: "Подготовить запрос в суд", sub: "по делу № 2-777/2024", time: "22 мая", done: false, group: "upcoming" },
];

export const cases: CaseItem[] = [
  {
    id: "c1",
    caseNo: "А56-12345/2024",
    status: "В производстве",
    statusTone: "active",
    client: "ООО «СтройИнвест»",
    court: "Кинешемский городской суд",
    subject: "Иск о взыскании задолженности",
    claim: "Сумма иска: 2 450 000 ₽",
    next: "След. заседание: 20.05.2024 10:30",
  },
  {
    id: "c2",
    caseNo: "А40-98765/2024",
    status: "Подготовка",
    statusTone: "prep",
    client: "ИП Смирнов А.А.",
    court: "Арбитражный суд г. Москвы",
    subject: "Оспаривание решения налогового органа",
    claim: "Сумма иска: 1 120 000 ₽",
    next: "След. заседание: 22.05.2024 11:00",
  },
  {
    id: "c3",
    caseNo: "2-678/2024",
    status: "В производстве",
    statusTone: "active",
    client: "Петров И.С.",
    court: "Кинешемский городской суд",
    subject: "Взыскание ущерба",
    claim: "Сумма иска: 350 000 ₽",
    next: "След. заседание: 20.05.2024 15:00",
  },
  {
    id: "c4",
    caseNo: "2-345/2024",
    status: "Архив",
    statusTone: "archive",
    client: "Иванова Е.В.",
    court: "Кинешемский городской суд",
    subject: "Раздел имущества",
    claim: "Дело завершено",
    next: "Решение вступило в силу",
  },
];

export const calMonday: CalDay[] = [
  { time: "10:30", caseNo: "А56-12345/2024", place: "Кинешемский городской суд, зал 3", type: "Судебное заседание" },
  { time: "15:00", caseNo: "2-678/2024", place: "Кинешемский городской суд, зал 2", type: "Судебное заседание" },
  { time: "18:00", caseNo: "Встреча с доверителем", place: "ООО «СтройИнвест», офис", type: "" },
];

export const calTuesday: CalDay[] = [
  { time: "11:00", caseNo: "А40-98765/2024", place: "Арбитражный суд г. Москвы, зал 5", type: "Судебное заседание" },
];

export const features = [
  { icon: "shield", title: "Полный контроль", text: "Все дела, сроки и заседания на одном экране." },
  { icon: "sparkle", title: "Умные подсказки", text: "Система уведомляет о важных сроках и задачах заранее." },
  { icon: "lock", title: "Конфиденциальность", text: "Ваши данные под надёжной защитой." },
  { icon: "chart", title: "Аналитика", text: "Отчёты и статистика для повышения эффективности." },
  { icon: "cpu", title: "Технологичность", text: "Современный интерфейс для продуктивной работы." },
  { icon: "check-shield", title: "Надёжность", text: "Работает офлайн, данные не теряются." },
];
