// Zod schemas for the raw HMS API responses. Only the fields we use are declared;
// unknown fields are stripped. The API is undocumented and can change without notice,
// so a failed parse means "keep the existing /data snapshot".
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const TeamRef = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1),
  logoUrl: z.string().nullable(),
});

export const GameSchema = z.object({
  gameId: z.string().min(1),
  name: z.string(),
  status: z.enum(["NOT PLAYED", "RUNNING", "FINISHED"]),
  startDate: date,
  startTime: time,
  HomeTeamGoals: z.number().int().nullable(),
  AwayTeamGoals: z.number().int().nullable(),
  Phase: z.object({
    phaseId: z.string(),
    name: z.string(),
    Group: z.object({ groupId: z.string(), name: z.string() }),
  }),
  HomeTeam: TeamRef.nullable(),
  AwayTeam: TeamRef.nullable(),
  Venue: z.object({ name: z.string(), short: z.string().nullish() }).nullable(),
  GameStars: z
    .array(
      z.object({
        teamId: z.string(),
        LineupNumber: z.number().int().nullable(),
        Player: z.object({ firstName: z.string(), lastName: z.string() }),
      }),
    )
    .nullish(),
});
export const GamesSchema = z.array(GameSchema);

export const StandingsSchema = z.array(
  z.object({
    TeamId: z.string().min(1),
    "Team Name": z.string().min(1),
    "Team Name Short": z.string().nullish(),
    TeamLogo: z.string().nullish(),
    "Total Games": z.number().int(),
    Wins: z.number().int(),
    Draws: z.number().int(),
    Losses: z.number().int(),
    "Total Points": z.number().int(),
    Score: z.string().regex(/^\d+:\d+$/),
    "Total Penalty Minutes": z.string().regex(/^\d+:\d{2}$/),
  }),
);

export const CompetitionInfoSchema = z.object({
  Competitions: z.array(
    z.object({
      competitionId: z.string(),
      name: z.string(),
      Seasons: z.array(
        z.object({
          seasonId: z.string(),
          name: z.string(),
          startDate: date.nullable(),
          endDate: date.nullable(),
          Groups: z.array(
            z.object({
              groupId: z.string(),
              name: z.string(),
              Phases: z.array(z.object({ phaseId: z.string(), name: z.string() })),
            }),
          ),
        }),
      ),
    }),
  ),
});
