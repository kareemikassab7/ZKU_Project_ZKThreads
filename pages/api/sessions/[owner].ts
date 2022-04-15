import type { NextApiRequest, NextApiResponse } from "next"
import excuteQuery from '../../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const {
    query: { owner }
  } = req

  const result = await excuteQuery({
    query: 'SELECT sessionId, name, hosts, description, owner, created_at, status FROM ama_sessions WHERE owner = ?',
    values: [owner]
  });
  console.log(result)
  res.status(200).send(result)
}