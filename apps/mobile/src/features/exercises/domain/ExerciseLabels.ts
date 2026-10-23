import type { BodyPart, ExerciseDefinition, TrackingProfileId } from "./ExerciseModel.ts";

/** Русские подписи метаданных каталога (§39.10: локализация — слой над canonical identity). */

export const bodyPartLabels: Readonly<Record<BodyPart, string>> = {
  chest: "Грудь",
  back: "Спина",
  shoulders: "Плечи",
  upper_arms: "Руки",
  lower_arms: "Предплечья",
  core: "Пресс и кор",
  upper_legs: "Бёдра и ягодицы",
  lower_legs: "Голени",
  full_body: "Всё тело",
};
export function bodyPartLabel(part: BodyPart | null): string {
  return part === null ? "Группа мышц не указана" : bodyPartLabels[part];
}
export function exerciseEquipmentLabel(definition: ExerciseDefinition): string {
  return definition.equipmentUnspecified ? "Оборудование не указано" : equipmentLabel(definition.equipment);
}

export const trackingProfileLabels: Readonly<Record<TrackingProfileId, string>> = {
  REPS: "Повторы",
  LOAD_REPS: "Вес × повторы",
  ADDED_LOAD_REPS: "Доп. вес × повторы",
  ASSISTANCE_REPS: "Помощь × повторы",
  DURATION: "Время",
  REPS_DURATION: "Повторы за время",
  DISTANCE_DURATION: "Дистанция и время",
  LOAD_DISTANCE: "Вес и дистанция",
  LOAD_DURATION: "Вес и время",
};

const muscleLabels: Readonly<Record<string, string>> = {
  rectus_abdominis: "прямая мышца живота",
  transverse_abdominis: "поперечная мышца живота",
  obliques: "косые мышцы живота",
  hamstrings: "задняя поверхность бедра",
  quadriceps: "квадрицепс",
  latissimus_dorsi: "широчайшие",
  pectoralis_major: "большая грудная",
  anterior_deltoid: "передняя дельта",
  lateral_deltoid: "средняя дельта",
  posterior_deltoid: "задняя дельта",
  triceps_brachii: "трицепс",
  biceps_brachii: "бицепс",
  brachialis: "плечевая мышца",
  brachioradialis: "плечелучевая мышца",
  erector_spinae: "разгибатели спины",
  adductors: "приводящие мышцы бедра",
  abductors: "отводящие мышцы бедра",
  gastrocnemius: "икроножная",
  soleus: "камбаловидная",
  tibialis_anterior: "передняя большеберцовая",
  gluteus_medius: "средняя ягодичная",
  gluteus_maximus: "большая ягодичная",
  rhomboids: "ромбовидные",
  trapezius: "трапеция",
  forearm_flexors: "сгибатели предплечья",
  forearm_extensors: "разгибатели предплечья",
  forearms: "предплечья",
  hip_flexors: "сгибатели бедра",
  quadratus_lumborum: "квадратная мышца поясницы",
  serratus_anterior: "передняя зубчатая",
  supraspinatus: "надостная",
};

const equipmentLabels: Readonly<Record<string, string>> = {
  ab_wheel: "ролик для пресса",
  air_bike: "аэробайк",
  pull_up_bar: "турник",
  dumbbell: "гантели",
  dip_machine: "тренажёр для отжиманий",
  assisted_pullup_machine: "гравитрон",
  stability_ball: "фитбол",
  resistance_band: "резиновая лента",
  loop_band: "мини-лента",
  barbell: "штанга",
  battle_rope: "канаты",
  lat_pulldown_machine: "верхний блок",
  flat_bench: "скамья",
  ez_bar: "EZ-гриф",
  plyo_box: "тумба",
  cable: "блок",
  chest_press_machine: "тренажёр для жима от груди",
  kettlebell: "гиря",
  seated_row_machine: "тренажёр для тяги",
  smith_machine: "Смит",
  leg_press: "платформа для жима ногами",
  dip_station: "брусья",
  elliptical: "эллипсоид",
  hack_squat: "гакк-машина",
  trap_bar: "трэп-гриф",
  hip_abduction_machine: "тренажёр для отведения бёдер",
  hip_adduction_machine: "тренажёр для сведения бёдер",
  treadmill: "беговая дорожка",
  jump_rope: "скакалка",
  leg_curl: "тренажёр для сгибания ног",
  leg_extension: "тренажёр для разгибания ног",
  back_extension_machine: "тренажёр для разгибания спины",
  bicep_curl_machine: "тренажёр для бицепса",
  standing_calf_raise_machine: "тренажёр для икр стоя",
  chest_fly_machine: "тренажёр для сведения рук",
  preacher_curl_machine: "тренажёр Скотта",
  reverse_fly_machine: "тренажёр для обратных разведений",
  ab_crunch_machine: "тренажёр для пресса",
  shoulder_press_machine: "тренажёр для жима вверх",
  tricep_extension_machine: "тренажёр для трицепса",
  slam_ball: "слэмбол",
  glute_ham_developer: "GHD",
  pec_deck: "пек-дек",
  donkey_calf_raise_machine: "тренажёр «ослик»",
  hip_thrust_machine: "тренажёр для ягодичного моста",
  plate_loaded_lateral_raise_machine: "рычажный тренажёр для разведений",
  plate_loaded_dip_machine: "рычажный тренажёр для отжиманий",
  shrug_machine: "тренажёр для шрагов",
  plates: "блины",
  rings: "кольца",
  climbing_rope: "канат",
  rower: "гребной тренажёр",
  seated_calf_raise_machine: "тренажёр для икр сидя",
  ski_erg: "лыжный тренажёр",
  sled: "сани",
  stair_climber: "степпер-лестница",
  stationary_bike: "велотренажёр",
  suspension_trainer: "петли TRX",
  wrist_roller: "ролик для запястий",
};

/** Неизвестное значение источника показывается как есть, а не теряется. */
export function muscleLabel(id: string): string { return muscleLabels[id] ?? id.replace(/_/g, " "); }

export function equipmentLabel(id: string | null): string {
  return id === null ? "без оборудования" : equipmentLabels[id] ?? id.replace(/_/g, " ");
}

export const KNOWN_EQUIPMENT = Object.keys(equipmentLabels);
