export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// No provider chosen yet (docs/todo.md open questions). Everything that
// sends email — right now just the reminder job — depends only on the
// EmailSender interface above, so swapping in a real provider later (SES,
// Postmark, Resend, whatever) is a new class implementing it plus one line
// in getEmailSender(), not a rewrite of the calling code.
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(`\n[email:dummy] to=${message.to}\nsubject: ${message.subject}\n${message.text}\n`);
  }
}

export function getEmailSender(): EmailSender {
  return new ConsoleEmailSender();
}
