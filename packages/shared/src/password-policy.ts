export const minimumPasswordLength = 8;
export const maximumPasswordLength = 200;

export const passwordLengthIsValid = (password: string): boolean =>
  password.length >= minimumPasswordLength && password.length <= maximumPasswordLength;
