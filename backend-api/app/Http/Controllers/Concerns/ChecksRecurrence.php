<?php

namespace App\Http\Controllers\Concerns;

use App\Models\MaintenanceTicket;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Support\Carbon;

/**
 * Recurring-fault detection, shared between TicketController (recurrence at
 * creation time) and FleetController (recurrence checked on-demand, BEFORE a
 * ticket exists, so Admin can see it while still deciding).
 *
 * Originally this only counted Closed Tickets — a fault fixed via a
 * standalone Maintenance Record (a roadside repair, an external shop) was
 * invisible, so a vehicle genuinely fixed 3 times could read as zero
 * recurrences. This counts both, on the same 90-day/same-vehicle window.
 *
 * Matching is keyed on fault_category when given (issue_type's vocabulary —
 * "Brake Problem" — the same standardized catalog fault_category mirrors).
 * A Maintenance Record has no fault_category of its own, so it only counts
 * toward a category match when it's linked to an Issue Report that carries
 * one. Without a category at all, both fall back to normalized-title/
 * problem-reason text matching — best-effort, same as the original ticket-only
 * check.
 */
trait ChecksRecurrence
{
    // Moved here from TicketController so FleetController can share it too.
    // Compares titles after stripping the "[Issue #N] " prefix a ticket gets
    // when auto-titled from an Issue Report — otherwise a manually-typed
    // "Engine Problem" never matches an existing "[Issue #9] Engine Problem"
    // on the same vehicle even though they're the same Main Issue, letting a
    // true duplicate through. Also used for matching titles/problem_reason in
    // checkRecurrence() below.
    private function normalizeTicketTitle(string $title): string
    {
        $stripped = preg_replace('/^\[Issue #\d+\]\s*/i', '', trim($title));

        return mb_strtolower(trim($stripped));
    }

    private function checkRecurrence(int $vehicleId, ?string $faultCategory, string $title, int $days = 90): array
    {
        $since = now()->subDays($days);
        $normalizedTitle = $this->normalizeTicketTitle($title);

        $priorTickets = MaintenanceTicket::where('vehicle_id', $vehicleId)
            ->where('status', 'Closed')
            ->where('closed_at', '>=', $since)
            ->when($faultCategory, fn ($q) => $q->where('fault_category', $faultCategory))
            ->when(!$faultCategory, fn ($q) => $q->whereRaw('LOWER(TRIM(ticket_title)) = ?', [$normalizedTitle]))
            ->get(['ticket_id as id', 'closed_at as occurred_at']);

        $priorRecords = VehicleMaintenanceRecord::where('vehicle_id', $vehicleId)
            ->where('progress_status', 'Completed')
            ->where('date_completed', '>=', $since->toDateString())
            ->when(
                $faultCategory,
                fn ($q) => $q->whereHas('issueReport', fn ($iq) => $iq->where('issue_type', $faultCategory)),
                fn ($q) => $q->whereRaw('LOWER(TRIM(problem_reason)) = ?', [$normalizedTitle])
            )
            ->get(['maintenance_id as id', 'date_completed as occurred_at']);

        $all = $priorTickets->map(fn ($t) => ['type' => 'ticket', 'id' => $t->id, 'occurred_at' => $t->occurred_at])
            ->concat($priorRecords->map(fn ($r) => ['type' => 'record', 'id' => $r->id, 'occurred_at' => $r->occurred_at]))
            ->sortByDesc('occurred_at')
            ->values();

        $last = $all->first();

        return [
            'count'         => $all->count(),
            'last_type'     => $last['type'] ?? null,
            'last_id'       => $last['id'] ?? null,
            'last_occurred' => $last ? Carbon::parse($last['occurred_at'])->toDateString() : null,
        ];
    }
}
