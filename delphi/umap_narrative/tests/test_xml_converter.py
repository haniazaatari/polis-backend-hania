#!/usr/bin/env python3
"""
Unit tests for the XML converter module.
"""

import os
import sys
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

# Add parent directory to path to allow imports
script_dir = Path(__file__).parent
parent_dir = script_dir.parent.parent
sys.path.append(str(parent_dir))

# Import module to test
from umap_narrative.utils.xml_converter import PolisXMLConverter

class TestXMLConverter(unittest.TestCase):
    """Test the PolisXMLConverter class."""
    
    def setUp(self):
        """Set up test fixtures."""
        # Sample comment data with group information
        self.sample_data = [
            {
                "comment-id": 1,
                "comment": "This is a test comment",
                "total-votes": 100,
                "total-agrees": 50,
                "total-disagrees": 30,
                "total-passes": 20,
                "group-0-votes": 30,
                "group-0-agrees": 15,
                "group-0-disagrees": 10,
                "group-0-passes": 5,
                "group-1-votes": 40,
                "group-1-agrees": 20,
                "group-1-disagrees": 15,
                "group-1-passes": 5
            },
            {
                "comment-id": 2,
                "comment": "Another test comment",
                "total-votes": 200,
                "total-agrees": 100,
                "total-disagrees": 60,
                "total-passes": 40,
                "group-0-votes": 60,
                "group-0-agrees": 30,
                "group-0-disagrees": 20,
                "group-0-passes": 10,
                "group-1-votes": 80,
                "group-1-agrees": 40,
                "group-1-disagrees": 30,
                "group-1-passes": 10
            }
        ]
        
        # Sample data with missing group votes
        self.missing_group_data = [
            {
                "comment-id": 3,
                "comment": "Comment with missing group votes",
                "total-votes": 150,
                "total-agrees": 75,
                "total-disagrees": 45,
                "total-passes": 30
            }
        ]
        
        # Sample data with partial group coverage
        self.partial_coverage_data = [
            {
                "comment-id": 4,
                "comment": "Comment with partial group coverage",
                "total-votes": 150,
                "total-agrees": 75,
                "total-disagrees": 45,
                "total-passes": 30,
                "group-0-votes": 50,
                "group-0-agrees": 25,
                "group-0-disagrees": 15,
                "group-0-passes": 10
            }
        ]
    
    def test_convert_to_xml_basic(self):
        """Test basic XML conversion."""
        xml_output = PolisXMLConverter.convert_to_xml(self.sample_data)
        
        # Check that the output is a string
        self.assertIsInstance(xml_output, str)
        
        # Parse the XML output
        root = ET.fromstring(xml_output.strip())
        
        # Check root element
        self.assertEqual(root.tag, "polis-comments")
        
        # Check comment elements
        comments = root.findall("comment")
        self.assertEqual(len(comments), 2)
        
        # Check first comment attributes
        first_comment = comments[0]
        self.assertEqual(first_comment.get("id"), "1")
        self.assertEqual(first_comment.get("votes"), "100")
        self.assertEqual(first_comment.get("agrees"), "50")
        self.assertEqual(first_comment.get("disagrees"), "30")
        self.assertEqual(first_comment.get("passes"), "20")
        
        # Check comment text
        text_elem = first_comment.find("text")
        self.assertEqual(text_elem.text, "This is a test comment")
        
        # Check group elements
        group0 = first_comment.find("group-0")
        self.assertIsNotNone(group0)
        self.assertEqual(group0.get("votes"), "30")
        self.assertEqual(group0.get("agrees"), "15")
        self.assertEqual(group0.get("disagrees"), "10")
        self.assertEqual(group0.get("passes"), "5")
        
        group1 = first_comment.find("group-1")
        self.assertIsNotNone(group1)
        self.assertEqual(group1.get("votes"), "40")
        self.assertEqual(group1.get("agrees"), "20")
        self.assertEqual(group1.get("disagrees"), "15")
        self.assertEqual(group1.get("passes"), "5")
    
    def test_convert_to_xml_missing_groups(self):
        """Test XML conversion with missing group data."""
        xml_output = PolisXMLConverter.convert_to_xml(self.missing_group_data)
        
        # Parse the XML output
        root = ET.fromstring(xml_output.strip())
        
        # Check comment elements
        comments = root.findall("comment")
        self.assertEqual(len(comments), 1)
        
        # Check comment attributes
        comment = comments[0]
        self.assertEqual(comment.get("id"), "3")
        self.assertEqual(comment.get("votes"), "150")
        
        # Should not have group elements
        group_elements = comment.findall("*")
        # We have one text element, but no group elements
        self.assertEqual(len(group_elements), 1)
        self.assertEqual(group_elements[0].tag, "text")
    
    def test_analyze_group_distribution(self):
        """Test analysis of group distribution."""
        # Test with full data
        analysis = PolisXMLConverter.analyze_group_distribution(self.sample_data)
        
        # Check total comments
        self.assertEqual(analysis["total_comments"], 2)
        
        # Check vote counts
        self.assertEqual(analysis["total_votes"], 300)
        self.assertEqual(analysis["total_group_votes"], 210)
        self.assertEqual(analysis["missing_votes"], 90)
        
        # Check group coverage percentage
        # Both comments have 70% coverage (70+70)/2 = 70%
        self.assertAlmostEqual(analysis["average_group_coverage"], 70.0)
        
        # Check comments with groups
        self.assertEqual(analysis["comments_with_groups"], 2)
        
        # Check groups found
        self.assertIn("0", analysis["groups_found"])
        self.assertIn("1", analysis["groups_found"])
    
    def test_analyze_partial_coverage(self):
        """Test analysis with partial group coverage."""
        analysis = PolisXMLConverter.analyze_group_distribution(self.partial_coverage_data)
        
        # Check total comments
        self.assertEqual(analysis["total_comments"], 1)
        
        # Check vote counts
        self.assertEqual(analysis["total_votes"], 150)
        self.assertEqual(analysis["total_group_votes"], 50)
        self.assertEqual(analysis["missing_votes"], 100)
        
        # Check group coverage percentage
        self.assertAlmostEqual(analysis["average_group_coverage"], 33.33333333333333)
        
        # Check per-comment coverage
        comment_coverage = analysis["group_coverage_by_comment"][4]["coverage_percent"]
        self.assertAlmostEqual(comment_coverage, 33.33333333333333)
    
    def test_analyze_missing_groups(self):
        """Test analysis with completely missing group data."""
        analysis = PolisXMLConverter.analyze_group_distribution(self.missing_group_data)
        
        # Check total comments
        self.assertEqual(analysis["total_comments"], 1)
        
        # Check vote counts
        self.assertEqual(analysis["total_votes"], 150)
        self.assertEqual(analysis["total_group_votes"], 0)
        self.assertEqual(analysis["missing_votes"], 150)
        
        # Check group coverage percentage
        self.assertEqual(analysis["average_group_coverage"], 0.0)
        
        # Check comments with groups
        self.assertEqual(analysis["comments_with_groups"], 0)

if __name__ == "__main__":
    unittest.main()