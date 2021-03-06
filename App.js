Ext.define('iterRecord', {
    extend: 'Ext.data.Model',
    fields: [
        { name: 'Iteration', type: 'string' },
        { name: 'During', type: 'float' },
        { name: 'After', type: 'float' },
        { name: 'Outstanding', type: 'float' },
        { name: 'Total', type: 'float' },
        { name: 'Average', type: 'float' }
    ]
});

Ext.define('Niks.Apps.TeamVelocity', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    id: 'niksTVapp',
    config: {
        defaultSettings: {
            UseDefects: true,
            UseTestSets: true,
            UseTestCases: true,
            StackColumns: false,
            ProjectInLabel: false
        }
    },

    listeners: {
        resize: function() {
            if ( Ext.getCmp('CapChart')) { Ext.getCmp('niksTVapp')._chartRefresh(); }
            return true;
        },
        scope: Ext.getCmp('niksTVapp')
    },

    items: [
        {
            xtype: 'container',
            id: 'header',
            layout: 'column',
            align: 'center',
            items: [
                {
                    xtype: 'rallydatefield',
                    itemId: 'StartDate',
                    stateful: true,
                    fieldLabel: 'Start Date',
                    value: Ext.Date.subtract( new Date(), Ext.Date.DAY, 90) // 90 days of previous iterations
                },
                {
                    xtype: 'rallydatefield',
                    fieldLabel: 'End Date',
                    stateful: true,
                    itemId: 'EndDate',
                    value: new Date()
                }
            ]
        }
    ],

    onSettingsUpdate: function(settings) {
         this._chartRefresh();
   },

    getSettingsFields: function() {
        return [
            {
               name: 'UseDefects',
               fieldLabel: 'Include Defects',
               xtype: 'rallycheckboxfield'
            },
            {
                name: 'UseTestCases',
                fieldLabel: 'Include TestCases',
                xtype: 'rallycheckboxfield'
            },
            {
                name: 'UseTestSets',
                fieldLabel: 'Include TestSets',
                xtype: 'rallycheckboxfield'
            },
            {
                name: 'StackColumns',
                fieldLabel: 'Stack Columns',
                xtype: 'rallycheckboxfield'
            },
            {
                name: 'ProjectInLabel',
                fieldLabel: 'Separate Teams',
                xtype: 'rallycheckboxfield'
            }

        ];
    },

    iterationOIDs: [],

    _chartRefresh: function()
    {
        //onSettingsUpdate calls us at the wrong time!
        if ( Ext.getCmp('CapChart')) { 
            Ext.getCmp('CapChart').destroy();
        }
            this.iterationOIDs = [];
            this._kickOff();
    },

    launch: function() {

        var me = this;

        me.down('#StartDate').on( {
            change: me._chartRefresh,
            scope: me
        });

        me.down('#EndDate').on( {
            change: me._chartRefresh,
            scope: me
        });

        this._kickOff();
    },

    _kickOff: function() {
        var me = this;

        Ext.create('Rally.data.wsapi.Store', {
            model: 'Iteration',
            autoLoad: 'true',
            filters: [
                {
                    property: 'StartDate',
                    operator: '>',
                    value: me.down('#StartDate').getValue()
                },
                {
                    property: 'StartDate',
                    operator: '<',
                    value: me.down('#EndDate').getValue()
                }
            ],
            sorters: [
                {
                    property: 'StartDate',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: function(store, data, success) {
//                    _.each(data, function(record) {
//                        app.iterationOIDs.push( {
//                            '_ref': record.get('_ref') } );
//                    });

                    // Now get stats
                    me._getStats(data);
                },
                scope: me
            }
        });




    },

    _getStats: function(allIterations) {

        // Create a sequence of OR 'ed filters
        var oredFilters = [];
        var me = this;
        var iterations = allIterations;
        
        //If we don't want to see all the individual team numbers...
        if (me.getSetting('ProjectInLabel') === false) {
            iterations =  _.uniq(allIterations, function(iteration) { return iteration.get('_refObjectName');});
        }

        //Iterations are or'ed together so we only have to do the one fetch, but then we have to sort them out afterwards

        _.each(iterations, function (iter) {
            oredFilters.push({ property: 'Iteration', value: iter.get('_ref')});
        });

        if (oredFilters.length === 0)
            oredFilters = null;

        var models = ['User Story'];

        if (this.getSetting('UseDefects')){
            models.push('Defect');
        }
        if (this.getSetting('UseTestCases')){
            models.push('Test Case');
        }
        if (this.getSetting('UseTestSets')){
            models.push('Test Set');
        }
        Ext.create('Rally.data.wsapi.artifact.Store', {
            models: ['User Story', 'Defect','Test Case', 'Test Set'],
            limit: Infinity,
            filters: Rally.data.wsapi.Filter.or(oredFilters),
            autoLoad: 'true',
            listeners: {
                load: function(store, data, success) {
                    var sortedUS = []; 
                    _.each(iterations, function(iter) {
                        sortedUS.push( {
                            'Iteration' : iter,
                            'data'      : _.filter(data,
                                                function(record) {
                                                    if (!record.get('Iteration')) { return false; }
                                                    if (me.getSetting('ProjectInLabel') === true) {
                                                        return record.get('Iteration')._ref === iter.get('_ref'); 
                                                    } else {
                                                        return record.get('Iteration')._refObjectName === iter.get('_refObjectName'); 
                                                    }
                                                })
                        });
                    });
                    var summs = [];
                    _.each(sortedUS,
                        function(n) {
                            if (n.data.length){

                                var lIter = n.Iteration.get('_refObjectName') +
                                                (me.getSetting('ProjectInLabel')?'(' + n.Iteration.get('Project')._refObjectName + ')':'');
                                var InIter = 0;
                                var AfterIter = 0;
                                var TotalIter = 0;
                                var Never = 0;
                                var iterEndDate = n.Iteration.get('EndDate');
                                _.each(n.data, function(p) {
                                    if ( p.get('AcceptedDate') ) {
                                        if ( p.get('AcceptedDate') <= iterEndDate) {
                                            InIter += p.get('PlanEstimate');
                                        } else {
                                            AfterIter += p.get('PlanEstimate');
                                        }
                                        TotalIter += p.get('PlanEstimate');
                                    }
                                    else {
                                        Never += p.get('PlanEstimate');
                                        TotalIter += p.get('PlanEstimate');
                                    }
                                });
                                summs.push(  {
                                        'Iteration': lIter,
                                        'During': InIter,
                                        'After': AfterIter,
                                        'Outstanding': Never,
                                        'Total': TotalIter,
                                        'Average': 0 });
                            }
                    });

                    //Now do least mean squares of load into load average
                    var results = me._leastSquares(_.pluck(summs, 'Total'), 1, summs.length);
                    for ( i = 0; i < summs.length; i++){
                        summs[i].Average =  results.yintercept + ((i+1) * results.slope);
                    }

                    //Create a local store for the chart to play with
                    var rStore = Ext.create( 'Ext.data.Store', {
                        model: 'iterRecord',
                        data: summs,
                        proxy: 'memory'
                    });

                    var colors = [
                        '#29a814',
                        '#ee8c19',
                        '#ef0a1b',
                        '#105cab',
                        '#307c1e',
                        '#4a1d7e'
                    ];

                    Ext.chart.theme.appTheme = Ext.extend(Ext.chart.theme.Base, {
                            constructor: function(config) {
                                Ext.chart.theme.Base.prototype.constructor.call(this, Ext.apply({
                                    colors: colors
                                }, config));
                            }
                        });

                    me.add({
                        xtype: 'chart',
                        theme: 'appTheme',
                        id: 'CapChart',
                        store: rStore,
                        style: 'background:#fff',
                        animate: true,
                        width: me.getWidth() - 50,
                        height: me.getHeight() - 80,
                        legend: {
                            position: 'bottom'
                        },
                        axes: [
                            {
                                type: 'Numeric',
                                position: 'left',
                                field: ['During', 'After', 'Outstanding', 'Total', 'Average'],
                                title: 'Velocity',
                                grid: true
                            },
                            {
                                type: 'Category',
                                position: 'bottom',
                                fields: ['Iteration'],
                                title: 'Iteration',
                                label: {
                                    rotate: {
                                        degrees: 90
                                    }
                                }

                            }
                        ],


                        series: [
                            {
                                type: 'column',
                                stacked: me.getSetting('StackColumns'),
                                axis: 'left',
                                xField: 'Iteration',
                                yField: ['During', 'After', 'Outstanding'],
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                },
                                tips: {
                                    trackMouse: true,
                                    renderer: me._tipsRenderer

                                }
                            },
                            {
                                type: 'line',
                                axis: 'left',
                                highlight: true,
                                xField: 'Iteration',
                                yField: 'Average',
                                markerConfig: {
                                    type: 'circle',
                                    size: 3
                                }
                            },
                            {
                                type: 'line',
                                axis: 'left',
                                highlight: true,
                                xField: 'Iteration',
                                yField: 'Total',
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                }
                            }

                        ]
                    });
                }
            },
            fetch: ['AcceptedDate', 'Iteration', 'PlanEstimate']
        });
    },

    _tipsRenderer: function(storeItem, item) {
        this.setTitle(item.yField);
        this.update(item.value[1]);
    },

    _leastSquares: function(todoValues, firstIndex, lastIndex) {
        var n = (lastIndex + 1) - firstIndex;
        var i;
        var sumx = 0.0, sumx2 = 0.0, sumy = 0.0, sumy2 = 0.0, sumxy = 0.0;
        var slope, yintercept;

        //Compute sums of x, x^2, y, y^2, and xy
        for (i = firstIndex; i <= lastIndex; i++) {
            sumx  = sumx  + i;
            sumx2 = sumx2 + i * i;
            sumy  = sumy  + todoValues[i-1];
            sumy2 = sumy2 + todoValues[i-1] * todoValues[i-1];
            sumxy = sumxy + i * todoValues[i-1];
        }
        slope = (n * sumxy - sumx * sumy) / (n * sumx2 - sumx * sumx);
        yintercept = (sumy * sumx2 - sumx * sumxy) / (n * sumx2 - sumx * sumx);

        return {slope: slope, yintercept: yintercept};
    }
});