<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "August 5, 2020";
$title = "Robotics Club Frequently Asked Questions";
$currentWebmaster = "Alexandra French";
$updateDate = "November 5, 2020";
$pageDescription = "Questions for the Robotics Club of Central Florida? Learn more about us on our FAQ page.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, faq, frequently asked questions, dues,
                               club dues, club directions, direction";
$url = "https://robotics.ucf.edu/faq/index";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");


// page content
include_once('assets/templates/faq.html');

// faq cards
include_once("assets/templates/faq-card.php");
$faqCard = new FaqCard();

?>

    <!-- tab panes -->
    <div class="tab-content">
      <div class="tab-pane container active" id="about-club">
        <div id="faq-accordionAbout">
          <?php 
          
            // all of the Q and As for section about
            $answer = "During Covid19, the club has limited physical presence. Meetings are all currently online on our
                  <a href=\"https://discord.gg/ypWpanw\">discord</a>. We are focusing on learning skills via workshops while working on
                  CAD, electrical, and software design. Dues have also been halved for FA2020 to accomodate for the lack of normal usage
                  of our lab.";
            $faqCard->generate("About", "What is the club's response to Covid19?", $answer, TRUE);
            
            $answer = "The Robotics Club of Central Florida is a group of undergraduate and graduate students that build robots. We build both autonomous and manual robots.";
            $faqCard->generate("About", "What is the Club About?", $answer, FALSE);
            
            $answer = "We have three teams corresponding to three robots: Bowser, Citrobot, and Demobot.";
            $faqCard->generate("About", "What teams are there?", $answer, FALSE);
            
            $answer = "Bowser is an autonomous ground vehicle for the intelligent ground vehicle competition in June.
                    This project will involve heavy programming work, remaking the electrical components of the bot, and minor mechanical work.";
            $faqCard->generate("About", "What is the Bowser team doing?", $answer, FALSE);
            
            $answer = "Citrobot is a 15lb combat robot.
                    This project will involve heavy mechanical and electrical work, with minor programming work.";
            $faqCard->generate("About", "What is the Citrobot team doing", $answer, FALSE);
            
            $answer = "Demobot is our demonstrative robot. It is created to demonstrate the
                  best aspects of robotics to the work every semester.
                  This project involves work from all disciplines.";
            $faqCard->generate("About", "What is the Demobot team doing?", $answer, FALSE);
            
            $answer = "Currently we are planning to go to IGVC 2021 and any local combat robot competitions.
                  Have a local competition? <a href=\"https://discord.gg/ypWpanw\">Let us know</a>.";
            $faqCard->generate("About", "What competitions do you go to?", $answer, FALSE);
            
          ?>
        </div>
      </div>
      <!-- /.about club-->
      <!-- members info -->
      <div class="tab-pane container fade" id="members-info">
        <div id="faq-accordionMembers">
          <?php
          
            // reset faqCard counter
            $faqCard->setCounter(1);
          
            // Questions and answers for section B (members info)
            $answer = "Come visit our <a href=\"https://discord.gg/ypWpanw\">Discord</a>!
                    With Covid19 we do not currently have many in-person events, so the best
                    way to meet us is virutally.";
            $faqCard->generate("Members", "How do I join the club?", $answer, TRUE);
            
            $answer = "All majors are welcome!";
            $faqCard->generate("Members", "What majors can join the club?", $answer, FALSE);
            
            $answer = "Any year, both undergraduate and graduate students.";
            $faqCard->generate("Members", "What years can join the club?", $answer, FALSE);
            
            $answer = "Bowser is an autonomous ground vehicle that involves electrical, mechanical, and
                    the majority of our computer science work.
                    Citrobot is a 15lb combat robot that involves significant mechanical and electrical work.
                    Demobot is a demonstrative robot that involves mechanical and electrical work, 
                    with some computer science work. Feel free to join any team that interests you at all!";
            $faqCard->generate("Members", "What team should I join?", $answer, FALSE);
            
            $answer = "That's fine! We record our meetings and are happy to work keeping you up to date on them
                  Additionally, even if Bowser has mostly coding work, there is still some coding to do on both Citrobot and Demobot.";
            $faqCard->generate("Members", "I want to code, but cannot make the days of the Bowser team.", $answer, FALSE);
            
            $answer = "That's fine! We record our meetings and are happy to work keeping you up to date on them. Additionally, even if Citrobot has the                    main mechanical work, there is still some work to do on Demobot and Bowser.";
            $faqCard->generate("Members", "I want to work on mechanics or electronics, but cannot make the days of the Citrobot team", $answer, FALSE);
            
            $answer = "Projects are not major specific, and you can join any project and any part.";
            $faqCard->generate("Members", "I am an ___ major, but I want to do ___.", $answer, FALSE);
            
            $answer = "That's fine! Most new members don't have prior experience.
                    There are workshops at the start of each semester and team members are happy to help with any questions.";
            $faqCard->generate("Members", "I have no experience with ___ but I want to try it.", $answer, FALSE);
            
            $answer = "Our presence is currently mostly virtual, however UCF has shuttles running to its partnerships until 10PM on:
                      <br>
                      M / Tu / W / Th / F
                      <br>
                      Ask if there's a carpool to join on our discord:
                      <a href=\"https://discord.gg/ypWpanw\">discord.gg</a>";
            $faqCard->generate("Members", "I don't have a car to get to the club.", $answer, FALSE);
            
            $answer = "Most of our current code is done in either Python3 or C++.";
            $faqCard->generate("Members", "What programming languages are used?", $answer, FALSE);
            
            $answer = "Yes. Dues are due the 3rd week of each semester. They are $20 per semester, except for FA20 which was reduced
                        by half due to covid19.";
            $faqCard->generate("Members", "Are there dues?", $answer, FALSE);
            
            $answer = "Of course! Join our <a href=\"https://discord.gg/ypWpanw\">Discord</a> to meet the team and see our virtual meetings.";
            $faqCard->generate("Members", "Can I join even though the new members meeting is over?", $answer, FALSE);
            
            $answer = "To get accepted on KnightsConnect, you must have paid your dues.
                  If you haven't been added yet, please let us know when you're next in the lab or on
                  <a href=\"https://discord.gg/ypWpanw\">Discord</a>.";
            $faqCard->generate("Members", "How do I get accepted on KnightsConnect?", $answer, FALSE);

          ?>
        </div>
      </div>
      <!-- /.members info -->
      <!-- misc -->
      <div class="tab-pane container fade" id="misc-info">
        <div id="faq-accordionMisc">
          <?php
            // reset faqCard counter
            $faqCard->setCounter(1);
            
            // all misc (section C) questions and answers
            $answer = "We have a handy guide on how to reach the lab at the bottom of our
                  <a href=\"../about/contact\">Contact Us</a> page.";
            $faqCard->generate("Misc", "I am lost.", $answer, TRUE);
            
            $answer = "If you want to contact us for any reason, you can use either our
                  <a href=\"https://discord.gg/ypWpanw\">Discord</a> or <a href=\"mailto:robotics@ucf.edu\">email</a>.
                  Our phone is not currently attended to due to Covid19.";
            $faqCard->generate("Misc", "Who can I contact about the club?", $answer, FALSE);
            
            $answer = "You can view all of our past projects on our <a href=\"../projects/index\">projects page</a>
                    , including the bots that have gone to competitions.";
            $faqCard->generate("Misc", "What has the club achieved in the past?", $answer, FALSE);
            
            $answer = "If you want to contact our members for any form of recruiting, you can
                  either shoot us an <a href=\"mailto:robotics@ucf.edu\">email</a> and we'll put out an announcement,
                  or you can come to our <a href=\"https://discord.gg/ypWpanw\">Discord</a>
                  and interact with the members firsthand!";
            $faqCard->generate("Misc", "I am recruiting for a project or company.", $answer, FALSE);
            
            $answer = "Projects are typically run by members who have taken part in prior projects
                  and have experience in what is needed for a project to succeed.
                  Projects are also typically presented to the club before choosing.";
            $faqCard->generate("Misc", "How are projects chosen?", $answer, FALSE);
            
            $answer = "Contact us with your questions via <a href=\"mailto:robotics@ucf.edu\">email</a>
                   or <a href=\"https://discord.gg/ypWpanw\">Discord</a>";
            $faqCard->generate("Misc", "I have other questions not answered here.", $answer, FALSE);
          ?>
        </div>
      </div>
      <!-- /.misc info -->
      <!-- subscribe info -->
      <div class="tab-pane container fade" id="subscribe">
        <div id="faq-accordionSubscribe" style="padding-bottom: 750px;">
          <?php
          
            // reset faqCard counter
            $faqCard->setCounter(1);
            
            // all misc (section C) questions and answers
            $answer = "Subscribe to our mail list:<br />
          <!--************* Begin MailChimp Signup Form *************-->
          <div id=\"mc_embed_signup\">
            <form action=\"//ucf.us11.list-manage.com/subscribe/post?u=ba5c2944886feb2964a80fe11&amp;id=e63d752fa6\" method=\"post\" id=\"mc-embedded-subscribe-form\" name=\"mc-embedded-subscribe-form\" class=\"validate\" target=\"_blank\" novalidate>
              <div id=\"mc_embed_signup_scroll\">
                <div class=\"mc-field-group\">
                     <label for=\"mce-EMAIL\">Email Address  <span class=\"asterisk\">*</span></label>
                     <input type=\"email\" value=\"\" name=\"EMAIL\" class=\"required email\" id=\"mce-EMAIL\">
                </div>
                <div class=\"mc-field-group\">
                  <label for=\"mce-MMERGE3\">First and Last Name  <span class=\"asterisk\">*</span></label>
                  <input type=\"text\" value=\"\" name=\"MMERGE3\" class=\"required\" id=\"mce-MMERGE3\">
                </div>
                <div class=\"indicates-required\" style=\"color:\"red\"\">
                  <span class=\"asterisk\">*</span> indicates required
                </div>
                <p>
                  <a href=\"https://us11.campaign-archive2.com/home/?u=ba5c2944886feb2964a80fe11&id=e63d752fa6\" title=\"View previous campaigns\" style=\"color:f1f0ea; font-size:12px\"  class=\"grid1-link\">View previous campaigns.</a>
                </p>
                <div id=\"mce-responses\" class=\"clear\">
                  <div class=\"response\" id=\"mce-error-response\" style=\"display:none; font-size:10px;\"></div>
                  <div class=\"response\" id=\"mce-success-response\" style=\"display:none; font-size:10px;\"></div>
                </div>
                <!--************* DO NOT REMOVE *************-->
                <!-- real people should not fill this in and expect good things - do not remove this or risk
                form bot signups-->
                <div style=\"position: absolute; left: -5000px;\" aria-hidden=\"true\">
                  <input type=\"text\" name=\"b_ba5c2944886feb2964a80fe11_e63d752fa6\"
                  tabindex=\"-1\" value=\"\">
                </div>
                <div class=\"clear\">
                  <input type=\"submit\" value=\"Subscribe\" name=\"subscribe\" id=\"mc-embedded-subscribe\" class=\"button\">
                </div>
              </div>
              </form>
            </div>
            <script type='text/javascript' src='https://s3.amazonaws.com/downloads.mailchimp.com/js/mc-validate.js'>
            </script>
            <script type='text/javascript'>
              (function($)
              {
                window.fnames = new Array();
                window.ftypes = new Array();
                fnames[0]='EMAIL';
                ftypes[0]='email';
                fnames[3]='MMERGE3';
                ftypes[3]='text';
              }
              (jQuery));var $mcj = jQuery.noConflict(true);
            </script>
            <!--End mc_embed_signup-->";
            $faqCard->generate("Subscribe", "How can I join the mailing list?", $answer, TRUE);
              
          ?>
        </div>
      </div>      
      <!-- /.subscribe info -->
    </div>
    <!-- /.tab content -->
  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");

?>