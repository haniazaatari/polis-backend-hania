#!/usr/bin/env python3
"""
Generate one vs. all analysis for participant groups from 703 clustering.

This script:
1. Loads participant group assignments from 703 UMAP clustering
2. Analyzes voting patterns to find distinctive positions for each group
3. Generates reports comparing each group to all others
4. Optionally uses LLM to generate semantic analysis

Usage:
    python 704_participant_group_analysis.py --zid=36324 [OPTIONS]

Args:
    --zid: Conversation ID
    --group: Specific group ID to analyze (optional, default: all groups)
    --use-llm: Use LLM to generate semantic group analysis
    --threshold: Minimum difference threshold for distinctive comments (default: 0.3)
    --output-dir: Output directory for reports (optional)
"""

import os
import sys
import json
import logging
import argparse
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
import traceback

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import from local modules
from polismath_commentgraph.utils.storage import PostgresClient
from polismath_commentgraph.utils.group_data import GroupDataProcessor

# Import the model provider (same as 800 script)
from umap_narrative.llm_factory_constructor import get_model_provider

import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_participant_groups_from_703(zid: int) -> Dict[int, int]:
    """
    Load participant group assignments from clustering results.
    
    This function looks for participant group assignments from:
    1. DynamoDB PCA participant projections (from math pipeline)
    2. DynamoDB UMAP participant clustering (from 703 script, if available)
    3. Fallback to PCA-based groups if UMAP groups not available
    
    Args:
        zid: Conversation ID
        
    Returns:
        Dictionary mapping participant_id -> group_id
    """
    logger.info(f"Loading participant groups for conversation {zid}")
    
    participant_groups = {}
    
    try:
        # Try to load from DynamoDB (both UMAP and PCA sources)
        participant_groups = _load_from_dynamodb(zid)
        
        if participant_groups:
            logger.info(f"Loaded {len(participant_groups)} participant group assignments from DynamoDB")
            group_distribution = {}
            for group_id in participant_groups.values():
                group_distribution[group_id] = group_distribution.get(group_id, 0) + 1
            logger.info(f"Group distribution: {group_distribution}")
            return participant_groups
            
    except Exception as e:
        logger.error(f"Error loading from DynamoDB: {e}")
    
    # Fallback: Try to load from PostgreSQL-based clustering if available
    try:
        participant_groups = _load_from_postgres_fallback(zid)
        if participant_groups:
            logger.info(f"Loaded {len(participant_groups)} participant group assignments from PostgreSQL fallback")
            return participant_groups
    except Exception as e:
        logger.error(f"Error loading from PostgreSQL fallback: {e}")
    
    # Final fallback: Generate placeholder data for testing
    logger.warning("No real clustering data found - using placeholder participant groups for testing")
    return _generate_placeholder_groups(zid)

def _load_from_dynamodb(zid: int) -> Dict[int, int]:
    """Load participant group assignments from DynamoDB."""
    import boto3
    from decimal import Decimal
    
    # Initialize DynamoDB client
    dynamodb = boto3.resource(
        'dynamodb',
        endpoint_url='http://polis-dynamodb-local:8000',
        region_name='us-east-1',
        aws_access_key_id='dummy',
        aws_secret_access_key='dummy'
    )
    
    participant_groups = {}
    
    # First try: Check if we have UMAP-based participant clustering (from 703 script)
    try:
        table = dynamodb.Table('Delphi_UMAPParticipantClusters')
        
        # Query for all participants in this conversation
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('conversation_id').eq(str(zid))
        )
        
        for item in response['Items']:
            # Extract participant_id and cluster_id
            participant_id = int(item['participant_id'])
            cluster_id = int(item['cluster_id']) if isinstance(item['cluster_id'], Decimal) else int(item['cluster_id'])
            participant_groups[participant_id] = cluster_id
            
        if participant_groups:
            logger.info(f"Successfully loaded UMAP-based participant groups from DynamoDB (703 clustering)")
            return participant_groups
            
    except Exception as e:
        logger.warning(f"Could not load UMAP participant clusters from 703: {e}")
    
    # Fallback: Check if we have PCA participant projections (from math pipeline)
    try:
        table = dynamodb.Table('Delphi_PCAParticipantProjections')
        
        # Query for all participants in this conversation
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('zid_tick').begins_with(str(zid))
        )
        
        for item in response['Items']:
            # Extract participant_id and group_id
            participant_id = int(item['participant_id'])
            group_id = int(item['group_id']) if isinstance(item['group_id'], Decimal) else int(item['group_id'])
            participant_groups[participant_id] = group_id
            
        if participant_groups:
            logger.info(f"Successfully loaded PCA-based participant groups from DynamoDB (fallback)")
            return participant_groups
            
    except Exception as e:
        logger.warning(f"Could not load PCA participant projections: {e}")
    
    return participant_groups

def _load_from_postgres_fallback(zid: int) -> Dict[int, int]:
    """Fallback: Try to derive groups from existing data."""
    # This could look for cached results or derive groups from other data
    # For now, return empty to trigger placeholder generation
    return {}

def _generate_placeholder_groups(zid: int) -> Dict[int, int]:
    """Generate placeholder participant groups for testing."""
    participant_groups = {}
    
    # Get actual participants from database to create realistic mapping
    postgres_client = PostgresClient()
    try:
        participants = postgres_client.get_participants_by_conversation(zid)
        logger.info(f"Found {len(participants)} participants for placeholder assignment")
        
        # Assign participants to 5 groups (simulating clustering results)
        for i, participant in enumerate(participants):
            pid = participant['pid']
            group_id = i % 5  # Simple assignment for testing
            participant_groups[pid] = group_id
            
        logger.info(f"Created {len(participant_groups)} placeholder participant group assignments")
        
    except Exception as e:
        logger.error(f"Error creating placeholder groups: {e}")
    finally:
        postgres_client.shutdown()
    
    return participant_groups

def generate_group_analysis_report(group_processor: GroupDataProcessor, zid: int, 
                                 participant_groups: Dict[int, int], group_id: int, 
                                 threshold: float = 0.3, use_llm: bool = False, 
                                 model_name: str = "claude-3-5-sonnet-20241022") -> Dict[str, Any]:
    """
    Generate one vs. all analysis report for a specific participant group.
    
    Args:
        group_processor: GroupDataProcessor instance
        zid: Conversation ID
        participant_groups: Dictionary mapping participant_id -> group_id
        group_id: Specific group to analyze
        threshold: Minimum difference threshold for distinctive comments
        use_llm: Whether to use LLM for semantic analysis
        
    Returns:
        Dictionary containing the analysis report
    """
    logger.info(f"Generating analysis report for group {group_id}")
    
    # Get distinctive comments for this group
    distinctive_data = group_processor.filter_participant_group_distinctive_comments(
        zid, participant_groups, group_id, threshold
    )
    
    # Calculate group statistics
    group_sizes = {}
    for pid, gid in participant_groups.items():
        group_sizes[gid] = group_sizes.get(gid, 0) + 1
    
    group_size = group_sizes.get(group_id, 0)
    
    # Create basic report structure
    report = {
        'group_id': group_id,
        'group_size': group_size,
        'analysis_threshold': threshold,
        'timestamp': datetime.now().isoformat(),
        'distinctive_agrees': distinctive_data['distinctive_agrees'][:10],  # Top 10
        'distinctive_disagrees': distinctive_data['distinctive_disagrees'][:10],  # Top 10
        'consensus_breaks': distinctive_data['consensus_breaks'][:10],  # Top 10
        'summary_stats': {
            'total_distinctive_agrees': len(distinctive_data['distinctive_agrees']),
            'total_distinctive_disagrees': len(distinctive_data['distinctive_disagrees']),
            'total_consensus_breaks': len(distinctive_data['consensus_breaks'])
        }
    }
    
    # Add LLM analysis if requested
    if use_llm:
        logger.info(f"Generating LLM analysis for group {group_id}")
        try:
            llm_analysis = generate_llm_group_analysis(
                distinctive_data, group_id, group_size, model_name
            )
            report['llm_analysis'] = llm_analysis
        except Exception as e:
            logger.error(f"Error generating LLM analysis: {e}")
            report['llm_analysis'] = {'error': str(e)}
    
    return report

def convert_distinctive_comments_to_xml(distinctive_data: Dict[str, Any]) -> str:
    """
    Convert distinctive comments to XML format for LLM analysis (same pattern as 800 script).
    
    Args:
        distinctive_data: Dictionary with distinctive_agrees, distinctive_disagrees, consensus_breaks
        
    Returns:
        XML string with comment data
    """
    # Create root element
    root = ET.Element("participant-group-analysis")
    
    # Add distinctive agreements section
    if distinctive_data['distinctive_agrees']:
        agrees_section = ET.SubElement(root, "distinctive-agreements")
        for item in distinctive_data['distinctive_agrees']:
            comment = ET.SubElement(agrees_section, "comment", {
                "id": str(item['comment_id']),
                "group-agree-pct": f"{item['group_agree_pct']:.3f}",
                "others-agree-pct": f"{item['others_agree_pct']:.3f}", 
                "difference": f"{item['difference']:.3f}",
                "group-votes": str(item['group_votes'])
            })
            text = ET.SubElement(comment, "text")
            text.text = item['comment_text']
    
    # Add distinctive disagreements section
    if distinctive_data['distinctive_disagrees']:
        disagrees_section = ET.SubElement(root, "distinctive-disagreements")
        for item in distinctive_data['distinctive_disagrees']:
            comment = ET.SubElement(disagrees_section, "comment", {
                "id": str(item['comment_id']),
                "group-disagree-pct": f"{item['group_disagree_pct']:.3f}",
                "others-disagree-pct": f"{item['others_disagree_pct']:.3f}",
                "difference": f"{item['difference']:.3f}",
                "group-votes": str(item['group_votes'])
            })
            text = ET.SubElement(comment, "text")
            text.text = item['comment_text']
    
    # Add consensus breaks section
    if distinctive_data['consensus_breaks']:
        consensus_section = ET.SubElement(root, "consensus-breaks")
        for item in distinctive_data['consensus_breaks']:
            comment = ET.SubElement(consensus_section, "comment", {
                "id": str(item['comment_id']),
                "group-agree-pct": f"{item['group_agree_pct']:.3f}",
                "overall-agree-pct": f"{item['overall_agree_pct']:.3f}",
                "difference": f"{item['difference']:.3f}",
                "group-votes": str(item['group_votes'])
            })
            text = ET.SubElement(comment, "text")
            text.text = item['comment_text']
    
    # Convert to string with pretty formatting
    rough_string = ET.tostring(root, 'unicode')
    reparsed = parseString(rough_string)
    return reparsed.toprettyxml(indent="  ")

def generate_llm_group_analysis(distinctive_data: Dict[str, Any], group_id: int, 
                               group_size: int, model_name: str = "claude-3-5-sonnet-20241022") -> Dict[str, str]:
    """
    Generate Claude-based semantic analysis of a participant group.
    
    Args:
        distinctive_data: Distinctive comments data from filtering
        group_id: Group ID being analyzed
        group_size: Number of participants in the group
        model_name: Claude model to use
        
    Returns:
        Dictionary with LLM-generated analysis
    """
    try:
        # Get the model provider for Claude (same approach as 800 script)
        provider = get_model_provider("anthropic", model_name)
        logger.info(f"Successfully initialized Anthropic provider for group {group_id}")
        
        # Prepare data for Claude analysis
        distinctive_agrees = distinctive_data['distinctive_agrees'][:7]  # Top 7 for Claude's better context
        distinctive_disagrees = distinctive_data['distinctive_disagrees'][:7]  # Top 7
        consensus_breaks = distinctive_data['consensus_breaks'][:5]  # Top 5
        
        # Create system message (instructions for Claude) - following 800 script citation pattern
        system_message = """You are an expert political analyst specializing in opinion group analysis.

Analyze a participant group's distinctive voting patterns compared to other groups in a conversation about fairness in New Zealand.

CRITICAL CITATION REQUIREMENTS:
- Every claim must be supported by comment IDs from the provided XML data
- Use comment IDs exactly as they appear in the XML (e.g., 746, 679, 752)
- Each analytical clause must include a "citations" array with relevant comment IDs
- Minimum 1 citation per claim, maximum 8 citations per claim
- Only cite comments that directly support your specific claim

Your task:
1. Identify what makes this group unique compared to all other groups
2. Infer their underlying values and priorities based on the specific comments
3. Give them a descriptive 3-6 word group identity name
4. Provide analysis with citations for every claim

Return your analysis in this exact JSON format:
{
  "group_identity": "Descriptive Group Name",
  "analysis_clauses": [
    {
      "text": "Specific claim about this group's distinctive position",
      "citations": [746, 679, 752]
    },
    {
      "text": "Another specific claim with different evidence", 
      "citations": [739, 774]
    },
    {
      "text": "Analysis of their underlying values",
      "citations": [535, 746]
    }
  ],
  "summary": "Brief 1-2 sentence overall characterization"
}

Base your analysis ONLY on the provided XML comment data. Every statement must be backed by specific comment citations."""

        # Convert distinctive comments to XML (same pattern as 800 script)
        xml_data = convert_distinctive_comments_to_xml(distinctive_data)
        
        # Create user message with XML data
        user_message = f"""Analyze this participant group of {group_size} people based on their distinctive voting patterns.

The XML below contains three types of distinctive comments for this group:

1. DISTINCTIVE-AGREEMENTS: Comments this group agrees with significantly more than other groups
2. DISTINCTIVE-DISAGREEMENTS: Comments this group disagrees with significantly more than other groups  
3. CONSENSUS-BREAKS: Comments where this group differs significantly from overall community consensus

Each comment includes:
- id: Comment ID (use these exact IDs in your citations)
- Voting percentages showing how this group differs from others
- text: The actual comment content

XML DATA:
{xml_data}

IMPORTANT: You MUST respond with ONLY the JSON structure requested in the system message. Do not include any additional text or explanation outside the JSON structure.

Example JSON format:
{{
  "group_identity": "Your Group Name",
  "analysis_clauses": [
    {{
      "text": "This group strongly supports X based on their distinctive agreement pattern",
      "citations": [503, 515]
    }},
    {{
      "text": "They show resistance to Y compared to other groups",
      "citations": [515]
    }}
  ],
  "summary": "Overall characterization of this group's political positioning"
}}

Analyze this group's distinctive characteristics and provide your response in the exact JSON format above with proper citations."""
        
        logger.info(f"Making Claude API call for group {group_id} (prompt length: {len(user_message)})")
        
        # Make Claude API call
        response_text = provider.get_response(system_message, user_message)
        
        logger.info(f"Claude response for group {group_id}: {response_text[:500]}...")
        
        try:
            # Try to parse JSON response from Claude
            import json
            parsed_response = json.loads(response_text.strip())
            
            # Check if Claude returned the correct format with analysis_clauses
            if 'analysis_clauses' in parsed_response:
                # Validate citations (same pattern as 800 script)
                validation_result = validate_citations(parsed_response, distinctive_data)
                
                # Add additional metadata
                parsed_response['size_description'] = f"This group contains {group_size} participants"
                parsed_response['comparison_summary'] = f"Distinctive in {len(distinctive_agrees)} agreements, {len(distinctive_disagrees)} disagreements vs other groups"
                parsed_response['model_used'] = model_name
                parsed_response['citation_validation'] = validation_result
                
                logger.info(f"Successfully generated Claude analysis for group {group_id} with citations")
                logger.info(f"Citation validation: {validation_result['valid_citations']}/{validation_result['total_citations']} valid")
                return parsed_response
            else:
                # Claude returned JSON but not in the expected citation format
                logger.warning(f"Claude returned valid JSON but without citation format for group {group_id}")
                logger.warning(f"Returned keys: {list(parsed_response.keys())}")
                
                # Convert to fallback format with more details
                return {
                    'group_identity': parsed_response.get('group_identity', f"Group {group_id}"),
                    'size_description': f"This group contains {group_size} participants",
                    'key_positions': parsed_response.get('key_positions', 'No specific positions identified'),
                    'values_inference': parsed_response.get('values_inference', 'No values inference available'),
                    'political_characterization': parsed_response.get('political_characterization', 'No characterization available'),
                    'comparison_summary': f"Distinctive in {len(distinctive_agrees)} agreements, {len(distinctive_disagrees)} disagreements",
                    'model_used': model_name,
                    'format_warning': 'Claude did not use citation format',
                    'claude_response_format': list(parsed_response.keys())
                }
            
        except json.JSONDecodeError as e:
            logger.warning(f"Could not parse JSON from Claude response for group {group_id}: {e}")
            logger.warning(f"Raw response (first 500 chars): {response_text[:500]}")
            logger.warning(f"Raw response (last 500 chars): {response_text[-500:]}")
            
            # Try to extract information from text response
            return {
                'group_identity': f"Group {group_id}",
                'size_description': f"This group contains {group_size} participants",
                'key_positions': response_text[:300] + "..." if len(response_text) > 300 else response_text,
                'values_inference': "Could not parse structured analysis from Claude response",
                'comparison_summary': f"Distinctive in {len(distinctive_agrees)} agreements, {len(distinctive_disagrees)} disagreements",
                'model_used': model_name,
                'raw_response': response_text,
                'json_parse_error': str(e)
            }
            
    except Exception as e:
        logger.error(f"Error in Claude analysis for group {group_id}: {e}")
        return generate_fallback_analysis(distinctive_data, group_id, group_size)

def validate_citations(response: Dict[str, Any], distinctive_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate that all citations in Claude's response refer to actual comments in the data.
    
    Args:
        response: Claude's JSON response with citations
        distinctive_data: Original distinctive comments data
        
    Returns:
        Dictionary with validation results
    """
    # Collect all valid comment IDs from the distinctive data
    valid_comment_ids = set()
    
    for item in distinctive_data.get('distinctive_agrees', []):
        valid_comment_ids.add(item['comment_id'])
    
    for item in distinctive_data.get('distinctive_disagrees', []):
        valid_comment_ids.add(item['comment_id'])
        
    for item in distinctive_data.get('consensus_breaks', []):
        valid_comment_ids.add(item['comment_id'])
    
    # Extract all citations from Claude's response
    total_citations = 0
    valid_citations = 0
    invalid_citations = []
    
    if 'analysis_clauses' in response:
        for clause in response['analysis_clauses']:
            if 'citations' in clause:
                for citation in clause['citations']:
                    total_citations += 1
                    if citation in valid_comment_ids:
                        valid_citations += 1
                    else:
                        invalid_citations.append({
                            'citation': citation,
                            'clause': clause['text'][:100] + "..." if len(clause['text']) > 100 else clause['text']
                        })
    
    validation_result = {
        'total_citations': total_citations,
        'valid_citations': valid_citations,
        'invalid_citations': invalid_citations,
        'validation_rate': (valid_citations / total_citations) if total_citations > 0 else 0,
        'valid_comment_ids': list(valid_comment_ids)
    }
    
    return validation_result

def generate_fallback_analysis(distinctive_data: Dict[str, Any], group_id: int, 
                              group_size: int) -> Dict[str, str]:
    """Generate fallback analysis when LLM is not available."""
    distinctive_agrees = distinctive_data['distinctive_agrees']
    distinctive_disagrees = distinctive_data['distinctive_disagrees']
    
    # Simple rule-based analysis
    if len(distinctive_agrees) > len(distinctive_disagrees):
        tendency = "agreement-focused"
    elif len(distinctive_disagrees) > len(distinctive_agrees):
        tendency = "opposition-focused"
    else:
        tendency = "balanced"
    
    return {
        'group_identity': f"Group {group_id} ({tendency})",
        'size_description': f"This group contains {group_size} participants",
        'key_positions': f"Shows distinctive patterns in {len(distinctive_agrees)} agreements and {len(distinctive_disagrees)} disagreements",
        'values_inference': f"Appears to be {tendency} in their approach to the conversation topics",
        'comparison_summary': f"Distinctive in {len(distinctive_agrees)} agreements, {len(distinctive_disagrees)} disagreements vs other groups"
    }

def save_reports(reports: Dict[int, Dict[str, Any]], output_dir: Optional[str], zid: int):
    """
    Save generated reports to files.
    
    Args:
        reports: Dictionary of group_id -> report data
        output_dir: Output directory (optional)
        zid: Conversation ID for filename
    """
    if output_dir:
        output_path = Path(output_dir)
    else:
        output_path = Path(f"./participant_group_analysis_{zid}")
    
    output_path.mkdir(exist_ok=True)
    
    # Save individual group reports
    for group_id, report in reports.items():
        filename = output_path / f"group_{group_id}_analysis.json"
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2)
        logger.info(f"Saved report for group {group_id} to {filename}")
    
    # Save summary report
    summary = {
        'conversation_id': zid,
        'timestamp': datetime.now().isoformat(),
        'total_groups': len(reports),
        'group_summaries': {}
    }
    
    for group_id, report in reports.items():
        summary['group_summaries'][group_id] = {
            'group_size': report['group_size'],
            'distinctive_agrees': report['summary_stats']['total_distinctive_agrees'],
            'distinctive_disagrees': report['summary_stats']['total_distinctive_disagrees'],
            'consensus_breaks': report['summary_stats']['total_consensus_breaks']
        }
    
    summary_filename = output_path / f"conversation_{zid}_group_analysis_summary.json"
    with open(summary_filename, 'w') as f:
        json.dump(summary, f, indent=2)
    
    logger.info(f"Saved summary report to {summary_filename}")

def main():
    """Main function to parse arguments and execute participant group analysis."""
    parser = argparse.ArgumentParser(description="Generate participant group one vs. all analysis")
    parser.add_argument("--zid", type=int, required=True, help="Conversation ID")
    parser.add_argument("--group", type=int, help="Specific group ID to analyze (optional)")
    parser.add_argument("--use-llm", action='store_true', 
                        help="Use Claude to generate semantic group analysis")
    parser.add_argument("--model", type=str, default="claude-3-5-sonnet-20241022",
                        help="Claude model to use (default: claude-3-5-sonnet-20241022)")
    parser.add_argument("--threshold", type=float, default=0.3,
                        help="Minimum difference threshold for distinctive comments (default: 0.3)")
    parser.add_argument("--output-dir", type=str, 
                        help="Output directory for reports (optional)")
    
    args = parser.parse_args()
    
    logger.info(f"Starting participant group analysis for conversation {args.zid}")
    logger.info(f"Threshold: {args.threshold}")
    logger.info(f"Use LLM: {args.use_llm}")
    
    try:
        # Load participant groups from 703 clustering
        participant_groups = load_participant_groups_from_703(args.zid)
        
        if not participant_groups:
            logger.error("No participant groups found. Make sure 703 script has been run.")
            return
        
        logger.info(f"Loaded {len(participant_groups)} participant group assignments")
        
        # Initialize group data processor
        postgres_client = PostgresClient()
        group_processor = GroupDataProcessor(postgres_client)
        
        # Generate reports
        reports = {}
        
        if args.group is not None:
            # Analyze specific group
            if args.group in set(participant_groups.values()):
                logger.info(f"Analyzing specific group: {args.group}")
                report = generate_group_analysis_report(
                    group_processor, args.zid, participant_groups, args.group, 
                    args.threshold, args.use_llm, args.model
                )
                reports[args.group] = report
            else:
                logger.error(f"Group {args.group} not found in participant groups")
                return
        else:
            # Analyze all groups
            unique_groups = set(participant_groups.values())
            logger.info(f"Analyzing all groups: {sorted(unique_groups)}")
            
            for group_id in sorted(unique_groups):
                if group_id == -1:  # Skip ungrouped participants
                    continue
                    
                logger.info(f"Processing group {group_id}")
                report = generate_group_analysis_report(
                    group_processor, args.zid, participant_groups, group_id,
                    args.threshold, args.use_llm, args.model
                )
                reports[group_id] = report
        
        # Save reports
        save_reports(reports, args.output_dir, args.zid)
        
        # Print summary
        print(f"\n=== Participant Group Analysis Summary ===")
        print(f"Conversation: {args.zid}")
        print(f"Groups analyzed: {len(reports)}")
        print(f"Threshold: {args.threshold}")
        
        for group_id, report in reports.items():
            print(f"\nGroup {group_id} ({report['group_size']} participants):")
            print(f"  - Distinctive agreements: {report['summary_stats']['total_distinctive_agrees']}")
            print(f"  - Distinctive disagreements: {report['summary_stats']['total_distinctive_disagrees']}")
            print(f"  - Consensus breaks: {report['summary_stats']['total_consensus_breaks']}")
        
        logger.info("Participant group analysis completed successfully")
        
    except Exception as e:
        logger.error(f"Error in participant group analysis: {e}")
        logger.error(traceback.format_exc())
        
    finally:
        # Cleanup
        try:
            postgres_client.shutdown()
        except:
            pass

if __name__ == "__main__":
    main()