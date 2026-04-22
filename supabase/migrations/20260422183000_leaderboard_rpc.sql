
CREATE OR REPLACE FUNCTION get_agent_leaderboard()
RETURNS TABLE (
    rank_position BIGINT,
    agent_name TEXT,
    day_orders BIGINT,
    week_orders BIGINT,
    is_current_user BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func
BEGIN
    RETURN QUERY
    WITH weekly_data AS (
        SELECT 
            o.agent_id,
            COUNT(o.id) FILTER (WHERE o.created_at >= date_trunc('day', timezone('GMT', now()))) AS day_count,
            COUNT(o.id) FILTER (WHERE o.created_at >= date_trunc('week', timezone('GMT', now()))) AS week_count
        FROM orders o
        WHERE o.agent_id IS NOT NULL AND o.status = 'fulfilled'
        GROUP BY o.agent_id
    ),
    ranked AS (
        SELECT 
            w.agent_id,
            w.day_count,
            w.week_count,
            RANK() OVER (ORDER BY w.day_count DESC, w.week_count DESC) as rnk
        FROM weekly_data w
        WHERE w.day_count > 0 OR w.week_count > 0
    )
    SELECT 
        r.rnk,
        CASE 
            WHEN r.agent_id = auth.uid() THEN p.full_name
            ELSE SUBSTRING(p.full_name FROM 1 FOR 3) || '***'
        END AS agent_name,
        r.day_count,
        r.week_count,
        (r.agent_id = auth.uid()) AS is_current_user
    FROM ranked r
    JOIN profiles p ON r.agent_id = p.user_id
    ORDER BY r.rnk ASC
    LIMIT 50;
END;
$func;

GRANT EXECUTE ON FUNCTION get_agent_leaderboard() TO authenticated;
