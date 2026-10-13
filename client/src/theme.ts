import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Kolor akcentu z makiet (#b5452b) w skali Mantine. */
const brick: MantineColorsTuple = [
  '#fbeee9',
  '#f6e3dd',
  '#eac0b2',
  '#de9b85',
  '#d37b5f',
  '#cc6747',
  '#b5452b',
  '#9c3a24',
  '#83301d',
  '#6a2617',
];

export const theme = createTheme({
  primaryColor: 'brick',
  primaryShade: 6,
  colors: { brick },
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'sm',
});
