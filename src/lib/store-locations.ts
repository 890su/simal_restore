// SIMAL's public contact page and its official @mebelSimal channel agree on these locations.
export const storeLocations = [
  {
    id: 'batumi',
    telephone: '+995571100515',
    displayPhone: '+995 571 10 05 15',
    street: {
      ru: 'ул. Давида Агмашенебели, 13Т',
      en: '13T David Agmashenebeli Street',
      ka: 'დავით აღმაშენებლის ქუჩა 13ტ',
    },
  },
  {
    id: 'tbilisi',
    telephone: '+995579404041',
    displayPhone: '+995 579 40 40 41',
    street: {
      ru: 'пр. Давида Гурамишвили, 17Б',
      en: '17B David Guramishvili Avenue',
      ka: 'დავით გურამიშვილის გამზირი 17ბ',
    },
  },
] as const;

export const storeHours = { opens: '10:00', closes: '19:00' };
