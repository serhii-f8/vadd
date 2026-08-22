import { useState } from 'react'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'

/**
 * `clarifying`'s primary element.
 *
 * The question lives only in the machine's `context.pendingClarification` — a
 * clarification writes no `decisions` row — so the aggregate carries it and this
 * renders it. `answer_clarification` is the one command the state accepts, and
 * without a control that posts it the state has no exit at all.
 */
export function ClarificationPrompt({
  question,
  onCommand,
}: {
  question: string | null
  onCommand: (body: Record<string, unknown>) => void
}) {
  const [answer, setAnswer] = useState('')

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">
        {/* No live actor means no context to read the question from. Say that,
            rather than showing an empty heading over an input. */}
        {question ?? 'The agent asked a question, which is no longer in memory.'}
      </h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (answer.trim() === '') return
          onCommand({ type: 'answer_clarification', answer })
        }}
      >
        <Input
          type="text"
          aria-label="Answer"
          className="flex-1"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <Button type="submit" variant="outline">
          Answer
        </Button>
      </form>
    </section>
  )
}
