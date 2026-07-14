const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z\s'-]{1,49}$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function countPhoneDigits(phone: string) {
  return phone.replace(/\D/g, "").length;
}

export function validateRegistrationInput(input: {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}): string | null {
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const phoneNumber = input.phoneNumber?.trim() ?? "";

  if (!firstName) return "First name is required";
  if (firstName.length < 2) return "First name must be at least 2 characters";
  if (!NAME_PATTERN.test(firstName)) {
    return "First name can only contain letters, spaces, hyphens, and apostrophes";
  }

  if (!lastName) return "Last name is required";
  if (lastName.length < 2) return "Last name must be at least 2 characters";
  if (!NAME_PATTERN.test(lastName)) {
    return "Last name can only contain letters, spaces, hyphens, and apostrophes";
  }

  if (!email) return "Email is required";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address";

  if (!phoneNumber) return "Phone number is required";
  const digits = countPhoneDigits(phoneNumber);
  if (digits < 10 || digits > 15) {
    return "Enter a valid phone number (10–15 digits)";
  }
  if (!/^[\d+\s()-]+$/.test(phoneNumber)) {
    return "Phone number contains invalid characters";
  }

  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!PASSWORD_PATTERN.test(password)) {
    return "Password must include uppercase, lowercase, and a number";
  }

  return null;
}
