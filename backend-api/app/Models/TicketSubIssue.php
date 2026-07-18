<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One root cause / line item under a MaintenanceTicket's Main Issue,
 * e.g. "Low coolant level" under the "Overheating" ticket. Runs its own
 * copy of the assign -> repair -> verify -> confirm pipeline, independent
 * of every other sub-issue on the same ticket.
 */
class TicketSubIssue extends Model
{
    protected $primaryKey = 'sub_issue_id';

    protected $fillable = [
        'ticket_id',
        'issue_report_id',
        'created_by',
        'title',
        'status',
        'assigned_mechanic_id',
        'maintenance_type',
        'work_order_notes',
        'mechanic_assigned_at',
        'mechanic_assigned_by',
        'repair_logs',
        'parts_used',
        'attachment_url',
        'repair_started_at',
        'repair_completed_at',
        'maintenance_cost',
        'verification_verdict',
        'verification_notes',
        'verified_by',
        'verified_at',
        'confirmation_verdict',
        'confirmation_notes',
        'confirmed_by',
        'confirmed_at',
    ];

    protected $casts = [
        'mechanic_assigned_at' => 'datetime',
        'verified_at'          => 'datetime',
        'confirmed_at'         => 'datetime',
        'maintenance_cost'     => 'decimal:2',
    ];

    public function ticket()
    {
        return $this->belongsTo(MaintenanceTicket::class, 'ticket_id', 'ticket_id');
    }

    public function issueReport()
    {
        return $this->belongsTo(VehicleIssueReport::class, 'issue_report_id', 'issue_report_id');
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignedMechanic()
    {
        return $this->belongsTo(User::class, 'assigned_mechanic_id');
    }

    public function mechanicAssignedBy()
    {
        return $this->belongsTo(User::class, 'mechanic_assigned_by');
    }

    public function verifiedBy()
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function confirmedBy()
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }
}
