<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MaintenanceTicket extends Model
{
    protected $primaryKey = 'ticket_id';

    protected $fillable = [
        'vehicle_id',
        'issue_report_id',
        'created_by',
        'ticket_title',
        'ticket_description',
        'priority',
        'status',
        'assigned_custodian_id',
        'assigned_at',
        'inspection_notes',
        'inspection_result',
        'inspected_by',
        'inspected_at',
        'closed_by',
        'closed_at',
        'closing_notes',
        'archived_at',
    ];

    protected $casts = [
        'assigned_at'  => 'datetime',
        'inspected_at' => 'datetime',
        'closed_at'    => 'datetime',
        'archived_at'  => 'datetime',
    ];

    protected $appends = ['progress'];

    // -------------------------------------------------------
    // Relationships
    // -------------------------------------------------------

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignedCustodian()
    {
        return $this->belongsTo(User::class, 'assigned_custodian_id');
    }

    public function inspectedBy()
    {
        return $this->belongsTo(User::class, 'inspected_by');
    }

    public function closedBy()
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function archiveLog()
    {
        return $this->hasOne(TicketArchiveLog::class, 'ticket_id', 'ticket_id');
    }

    public function issueReport()
    {
        return $this->belongsTo(VehicleIssueReport::class, 'issue_report_id', 'issue_report_id');
    }

    public function subIssues()
    {
        return $this->hasMany(TicketSubIssue::class, 'ticket_id', 'ticket_id');
    }

    // -------------------------------------------------------
    // Progress rollup
    // -------------------------------------------------------

    /**
     * "X/N sub-issues Done" — the ticket-level progress counter shown
     * in the UI, e.g. Overheating [2/3].
     */
    public function getProgressAttribute(): array
    {
        $total = $this->subIssues->count();
        $done  = $this->subIssues->where('status', 'Done')->count();

        return ['done' => $done, 'total' => $total];
    }

    /**
     * A ticket is eligible to Close when every sub-issue is Done.
     * A ticket with zero sub-issues (a "No Issues" inspection) is
     * also eligible — there was nothing to fix.
     */
    public function isEligibleToClose(): bool
    {
        return $this->subIssues->every(fn (TicketSubIssue $s) => $s->status === 'Done');
    }
}
