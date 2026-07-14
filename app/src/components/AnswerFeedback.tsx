import type { ReactNode } from 'react';
import SpeakButton from './SpeakButton';

interface Props {
  correct: boolean;
  /** Correct answer shown after a wrong attempt. */
  answer: string;
  /** Kyrgyz text the 🔊 button pronounces (often the answer, but e.g. the headword for RU→KG). */
  speakText: string;
  /** Optional tooltip override for the 🔊 button (defaults to SpeakButton's own label). */
  speakTitle?: string;
  /** Extra rows below the verdict line (example sentence, unverified note, speaking practice). */
  children?: ReactNode;
}

/** The post-answer verdict row (✓ Верно / ✗ Правильно: …) with a pronounce button, shared by
 *  every study/drill/exam/sentence flow. Extra content is passed as children. */
export default function AnswerFeedback({ correct, answer, speakText, speakTitle, children }: Props) {
  return (
    <div className={`study-feedback ${correct ? 'ok' : 'bad'}`}>
      <div>
        {correct ? '✓ Верно' : `✗ Правильно: ${answer}`}{' '}
        <SpeakButton text={speakText} title={speakTitle} />
      </div>
      {children}
    </div>
  );
}
