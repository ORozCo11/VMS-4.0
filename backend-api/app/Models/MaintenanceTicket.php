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
        'assigned_mechanic_id',
        'maintenance_type',
        'work_order_notes',
        'mechanic_assigned_at',
        'mechanic_assigned_by',
        'repair_logs',
        'parts_used',
        'repair_started_at',
        'repair_completed_at',
        'verification_verdict',
        'verification_notes',
        'verified_by',
        'verified_at',
        'confirmation_verdict',
        'confirmation_notes',
        'confirmed_by',
        'confirmed_at',
        'archived_at',
    ];

    protected $casts = [
        'assigned_at'          => 'datetime',
        'inspected_at'         => 'datetime',
        'mechanic_assigned_at' => 'datetime',
        'verified_at'          => 'datetime',
        'confirmed_at'         => 'datetime',
        'archived_at'          => 'datetime',
    ];

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

    public function archiveLog()
    {
        return $this->hasOne(TicketArchiveLog::class, 'ticket_id', 'ticket_id');
    }

    public function issueReport()
    {
        return $this->belongsTo(VehicleIssueReport::class, 'issue_report_id', 'issue_report_id');
    }
}
